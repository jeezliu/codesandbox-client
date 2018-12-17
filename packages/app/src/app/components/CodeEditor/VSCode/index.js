// @flow
import * as React from 'react';
import { TextOperation } from 'ot';
import { debounce } from 'lodash-es';
import { join, dirname } from 'path';
import { withTheme } from 'styled-components';
import { getModulePath, resolveModule } from 'common/sandbox/modules';
import { listen } from 'codesandbox-api';

import prettify from 'app/src/app/utils/prettify';
import DEFAULT_PRETTIER_CONFIG from 'common/prettify-default-config';

import getTemplate from 'common/templates';
import type {
  Module,
  Sandbox,
  ModuleError,
  ModuleCorrection,
} from 'common/types';
import { getTextOperation } from 'common/utils/diff';

/* eslint-disable import/no-webpack-loader-syntax */
import LinterWorker from 'worker-loader?publicPath=/&name=monaco-linter.[hash:8].worker.js!../Monaco/workers/linter';
/* eslint-enable import/no-webpack-loader-syntax */

import eventToTransform from '../Monaco/event-to-transform';
import MonacoEditorComponent from './MonacoReactComponent';
import type { EditorAPI } from './MonacoReactComponent';
import { Container } from './elements';
import defineTheme from '../Monaco/define-theme';
import getSettings from '../Monaco/settings';

import type { Props, Editor } from '../types';
import getMode from '../Monaco/mode';
import { liftOff } from '../Monaco/grammars/configure-tokenizer';
import {
  lineAndColumnToIndex,
  indexToLineAndColumn,
} from '../Monaco/monaco-index-converter';
import { updateUserSelections } from '../Monaco/live-decorations';

type State = {
  fuzzySearchEnabled: boolean,
};

function getSelection(lines, selection) {
  const startSelection = lineAndColumnToIndex(
    lines,
    selection.startLineNumber,
    selection.startColumn
  );
  const endSelection = lineAndColumnToIndex(
    lines,
    selection.endLineNumber,
    selection.endColumn
  );

  return {
    selection:
      startSelection === endSelection ? [] : [startSelection, endSelection],
    cursorPosition: lineAndColumnToIndex(
      lines,
      selection.positionLineNumber,
      selection.positionColumn
    ),
  };
}

class MonacoEditor extends React.Component<Props, State> implements Editor {
  static defaultProps = {
    width: '100%',
    height: '100%',
  };

  sandbox: $PropertyType<Props, 'sandbox'>;
  currentModule: $PropertyType<Props, 'currentModule'>;
  currentTitle: string;
  currentDirectoryShortid: ?string;
  settings: $PropertyType<Props, 'settings'>;
  dependencies: ?$PropertyType<Props, 'dependencies'>;
  tsconfig: ?$PropertyType<Props, 'tsconfig'>;
  disposeInitializer: ?() => void;
  syntaxWorker: ?Worker;
  lintWorker: ?Worker;
  editor: any;
  monaco: any;
  receivingCode: ?boolean = false;
  transpilationListener: ?Function;
  sizeProbeInterval: ?number;

  modelSelectionListener: {
    dispose: Function,
  };
  modelContentChangedListener: {
    dispose: Function,
  };

  constructor(props: Props) {
    super(props);
    this.state = {
      fuzzySearchEnabled: false,
    };
    this.sandbox = props.sandbox;
    this.currentModule = props.currentModule;
    this.currentTitle = props.currentModule.title;
    this.currentDirectoryShortid = props.currentModule.directoryShortid;
    this.settings = props.settings;
    this.dependencies = props.dependencies;

    this.tsconfig = props.tsconfig;

    this.lintWorker = null;
    this.sizeProbeInterval = null;

    this.resizeEditor = debounce(this.resizeEditor, 150);
    this.commitLibChanges = debounce(this.commitLibChanges, 300);
    this.onSelectionChangedDebounced = debounce(
      this.onSelectionChangedDebounced,
      500
    );

    this.transpilationListener = this.setupTranspilationListener();
  }

  shouldComponentUpdate(nextProps: Props) {
    if (
      this.props.width !== nextProps.width ||
      this.props.height !== nextProps.height
    ) {
      this.resizeEditorInstantly();
    }

    if (
      this.props.width &&
      this.props.height &&
      (this.props.width !== nextProps.width ||
        this.props.height !== nextProps.height)
    ) {
      this.resizeEditor();
    }

    const activeEditor = this.editor && this.editor.getActiveCodeEditor();

    if (this.props.readOnly !== nextProps.readOnly && activeEditor) {
      activeEditor.updateOptions({ readOnly: !!nextProps.readOnly });
    }

    if (this.props.theme.vscodeTheme !== nextProps.theme.vscodeTheme) {
      defineTheme(this.monaco, nextProps.theme.vscodeTheme);
    }

    return false;
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.resizeEditor);
    // Make sure that everything has run before disposing, to prevent any inconsistensies

    if (this.lintWorker) {
      this.lintWorker.terminate();
    }
    if (this.transpilationListener) {
      this.transpilationListener();
    }
    clearInterval(this.sizeProbeInterval);
    if (this.modelContentChangedListener) {
      this.modelContentChangedListener.dispose();
    }
    if (this.modelSelectionListener) {
      this.modelSelectionListener.dispose();
    }

    if (this.disposeInitializer) {
      this.disposeInitializer();
    }
  }

  updateModules = () => {
    if (
      this.currentTitle !== this.currentModule.title ||
      this.currentDirectoryShortid !== this.currentModule.directoryShortid
    ) {
      const id = this.currentModule.id;
      const title = this.currentModule.title;
      const directoryShortid = this.currentModule.directoryShortid;
      // Rename of current file.
      this.currentTitle = this.currentModule.title;
      this.currentDirectoryShortid = this.currentModule.directoryShortid;

      const editor = this.editor.getActiveCodeEditor();
      if (editor && editor.getValue() === (this.currentModule.code || '')) {
        const model = editor.model;
        const newPath = getModulePath(
          this.sandbox.modules,
          this.sandbox.directories,
          this.currentModule.id
        );
        this.editor.textFileService
          .move(model.uri, this.monaco.Uri.file(newPath))
          .then(() => {
            if (
              this.currentModule.id === id &&
              this.currentModule.title === title &&
              this.currentModule.directoryShortid === directoryShortid
            ) {
              this.editor.openFile(newPath);
            }
          });
      }
    }
  };

  getPrettierConfig = () => {
    try {
      const module = resolveModule(
        '/.prettierrc',
        this.sandbox.modules,
        this.sandbox.directories
      );

      const parsedCode = JSON.parse(module.code || '');

      return parsedCode;
    } catch (e) {
      return this.settings.prettierConfig || DEFAULT_PRETTIER_CONFIG;
    }
  };

  provideDocumentFormattingEdits = (model, options, token) =>
    prettify(
      model.uri.fsPath,
      () => model.getValue(),
      this.getPrettierConfig(),
      () => false,
      token
    ).then(newCode => [
      {
        range: model.getFullModelRange(),
        text: newCode,
      },
    ]);

  setupTranspilationListener() {
    return listen(({ type, code, path }) => {
      if (type === 'add-extra-lib') {
        const dtsPath = `${path}.d.ts`;
        this.monaco.languages.typescript.typescriptDefaults._extraLibs[
          `file:///${dtsPath}`
        ] = code;
        this.commitLibChanges();
      }
    });
  }

  configureEditor = async (editor: EditorAPI, monaco: any) => {
    this.editor = editor;
    this.monaco = monaco;

    // Load Vue eagerly
    getMode('stub.vue', monaco);

    monaco.languages.registerDocumentFormattingEditProvider('typescript', this);
    monaco.languages.registerDocumentFormattingEditProvider('javascript', this);
    monaco.languages.registerDocumentFormattingEditProvider('css', this);
    monaco.languages.registerDocumentFormattingEditProvider('less', this);
    monaco.languages.registerDocumentFormattingEditProvider('sass', this);
    monaco.languages.registerDocumentFormattingEditProvider('vue', this);
    monaco.languages.registerDocumentFormattingEditProvider('graphql', this);
    monaco.languages.registerDocumentFormattingEditProvider('html', this);
    monaco.languages.registerDocumentFormattingEditProvider('markdown', this);
    monaco.languages.registerDocumentFormattingEditProvider('json', this);

    // eslint-disable-next-line no-underscore-dangle
    window.CSEditor = {
      editor: this.editor,
      monaco: this.monaco,
    };

    editor.editorService.onDidActiveEditorChange(() => {
      if (this.modelContentChangedListener) {
        this.modelContentChangedListener.dispose();
      }
      if (this.modelSelectionListener) {
        this.modelSelectionListener.dispose();
      }

      const activeEditor = editor.getActiveCodeEditor();

      if (activeEditor) {
        const modulePath = `/sandbox${getModulePath(
          this.sandbox.modules,
          this.sandbox.directories,
          this.currentModule.id
        )}`;

        activeEditor.updateOptions({ readOnly: this.props.readOnly });

        this.modelContentChangedListener = activeEditor.onDidChangeModelContent(
          e => {
            if (activeEditor !== editor.getActiveCodeEditor()) {
              // This check ensures that we can't have multiple editor listeners working
              // with the current editor. I noticed an issue where we suddenly
              // had 2 listeners for 2 different editors and it updated code
              // for the current editor. This caused code to enter the wrong modules.
              return;
            }

            const path = activeEditor.model.uri.path;
            try {
              const module = resolveModule(
                path.replace(/^\/sandbox/, ''),
                this.sandbox.modules,
                this.sandbox.directories
              );

              const { isLive, sendTransforms } = this.props;

              if (
                path === modulePath &&
                isLive &&
                sendTransforms &&
                !this.receivingCode
              ) {
                this.sendChangeOperations(e);
              }

              this.handleChange(module.shortid, module.title);
            } catch (err) {
              if (process.env.NODE_ENV === 'development') {
                console.error('catched', err);
              }
            }
          }
        );

        this.modelSelectionListener = activeEditor.onDidChangeCursorSelection(
          selectionChange => {
            // TODO: add another debounced action to send the current data. So we can
            // have the correct cursor pos no matter what
            const { onSelectionChanged, isLive } = this.props;
            // Reason 3 is update by mouse or arrow keys
            if (isLive) {
              const lines = activeEditor.getModel().getLinesContent() || [];
              const data = {
                primary: getSelection(lines, selectionChange.selection),
                secondary: selectionChange.secondarySelections.map(s =>
                  getSelection(lines, s)
                ),
              };
              if (
                (selectionChange.reason === 3 ||
                  /* alt + shift + arrow keys */ selectionChange.source ===
                    'moveWordCommand' ||
                  /* click inside a selection */ selectionChange.source ===
                    'api') &&
                onSelectionChanged
              ) {
                this.onSelectionChangedDebounced.cancel();
                onSelectionChanged({
                  selection: data,
                  moduleShortid: this.currentModule.shortid,
                });
              } else {
                // This is just on typing, we send a debounced selection update as a
                // safeguard to make sure we are in sync
                this.onSelectionChangedDebounced({
                  selection: data,
                  moduleShortid: this.currentModule.shortid,
                });
              }
            }
          }
        );
      }
    });

    requestAnimationFrame(() => {
      if (this.editor && !this.editor.getActiveCodeEditor()) {
        this.openModule(this.currentModule);
      }
      this.setupWorkers();
    });

    monaco.languages.typescript.typescriptDefaults.setMaximumWorkerIdleTime(-1);
    monaco.languages.typescript.javascriptDefaults.setMaximumWorkerIdleTime(-1);

    this.setCompilerOptions();

    window.addEventListener('resize', this.resizeEditor);
    this.sizeProbeInterval = setInterval(() => {
      if (this.props.width && this.props.height) {
        return;
      }

      this.resizeEditorInstantly();
    }, 3000);

    const { dependencies } = this;
    if (dependencies != null) {
      if (Object.keys(dependencies)) {
        setTimeout(() => {
          this.getConfigSchemas();
        }, this.hasNativeTypescript() ? 500 : 5000);
      }
    }

    if (this.props.onInitialized) {
      this.disposeInitializer = this.props.onInitialized(this);
    }

    this.registerAutoCompletions();

    requestAnimationFrame(() => {
      liftOff(monaco);
    });
  };

  setCompilerOptions = () => {
    const hasNativeTypescript = this.hasNativeTypescript();
    const existingConfig = this.tsconfig ? this.tsconfig.compilerOptions : {};

    const compilerDefaults = {
      jsxFactory: 'React.createElement',
      reactNamespace: 'React',
      jsx: this.monaco.languages.typescript.JsxEmit.React,
      target: this.monaco.languages.typescript.ScriptTarget.ES2016,
      allowNonTsExtensions: !hasNativeTypescript,
      moduleResolution: this.monaco.languages.typescript.ModuleResolutionKind
        .NodeJs,
      module: hasNativeTypescript
        ? this.monaco.languages.typescript.ModuleKind.ES2015
        : this.monaco.languages.typescript.ModuleKind.System,
      experimentalDecorators: true,
      noEmit: true,
      allowJs: true,
      typeRoots: ['node_modules/@types'],

      forceConsistentCasingInFileNames:
        hasNativeTypescript && existingConfig.forceConsistentCasingInFileNames,
      noImplicitReturns:
        hasNativeTypescript && existingConfig.noImplicitReturns,
      noImplicitThis: hasNativeTypescript && existingConfig.noImplicitThis,
      noImplicitAny: hasNativeTypescript && existingConfig.noImplicitAny,
      strictNullChecks: hasNativeTypescript && existingConfig.strictNullChecks,
      suppressImplicitAnyIndexErrors:
        hasNativeTypescript && existingConfig.suppressImplicitAnyIndexErrors,
      noUnusedLocals: hasNativeTypescript && existingConfig.noUnusedLocals,

      newLine: this.monaco.languages.typescript.NewLineKind.LineFeed,
    };

    this.monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
      compilerDefaults
    );
    this.monaco.languages.typescript.javascriptDefaults.setCompilerOptions(
      compilerDefaults
    );

    this.monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: !hasNativeTypescript,
    });
  };

  setTSConfig = (config: Object) => {
    this.tsconfig = config;

    this.setCompilerOptions();
  };

  changeModule = (
    newModule: Module,
    errors?: Array<ModuleError>,
    corrections?: Array<ModuleCorrection>
  ) => {
    const oldModule = this.currentModule;
    this.swapDocuments(oldModule, newModule);

    this.currentModule = newModule;
    this.currentTitle = newModule.title;
    this.currentDirectoryShortid = newModule.directoryShortid;

    if (errors) {
      this.setErrors(errors);
    }

    if (corrections) {
      this.setCorrections(corrections);
    }

    if (this.props.onCodeReceived) {
      // Whenever the user changes a module we set up a state that defines
      // that the changes of code are not sent to live users. We need to reset
      // this state when we're doing changing modules
      this.props.onCodeReceived();
      this.liveOperationCode = '';
    }
  };

  onSelectionChangedDebounced = data => {
    if (this.props.onSelectionChanged) {
      this.props.onSelectionChanged(data);
    }
  };

  liveOperationCode = '';
  sendChangeOperations = changeEvent => {
    const { sendTransforms, isLive, onCodeReceived } = this.props;

    if (sendTransforms && changeEvent.changes) {
      this.liveOperationCode =
        this.liveOperationCode || this.currentModule.code || '';
      const { operation, newCode } = eventToTransform(
        changeEvent,
        this.liveOperationCode
      );

      this.liveOperationCode = newCode;

      sendTransforms(operation);

      requestAnimationFrame(() => {
        this.liveOperationCode = '';
      });
    } else if (!isLive && onCodeReceived) {
      onCodeReceived();
    }
  };

  userClassesGenerated = {};
  userSelectionDecorations = {};
  updateUserSelections = (
    userSelections: Array<
      | {
          userId: string,
          selection: null,
        }
      | {
          userId: string,
          name: string,
          selection: any,
          color: Array<number>,
        }
    >
  ) => {
    if (this.editor.getActiveCodeEditor()) {
      updateUserSelections(
        this.monaco,
        this.editor.getActiveCodeEditor(),
        this.currentModule,
        userSelections
      );
    }
  };

  changeSandbox = (
    newSandbox: Sandbox,
    newCurrentModule: Module,
    dependencies: $PropertyType<Props, 'dependencies'>
  ): Promise<null> =>
    new Promise(resolve => {
      if (this.modelContentChangedListener) {
        this.modelContentChangedListener.dispose();
      }
      if (this.modelSelectionListener) {
        this.modelSelectionListener.dispose();
      }
      this.sandbox = newSandbox;
      this.currentModule = newCurrentModule;
      this.dependencies = dependencies;

      // Do in setTimeout, since disposeModules is async
      setTimeout(() => {
        this.getConfigSchemas();
        resolve(null);
      });
    });

  changeCode = (code: string, moduleId?: string) => {
    if (
      code !== this.getCode() &&
      (!moduleId || this.currentModule.id === moduleId)
    ) {
      this.lint(
        code,
        this.currentModule.title,
        this.editor
          .getActiveCodeEditor()
          .getModel()
          .getVersionId()
      );
    }
  };

  applyOperationToModel = (
    operation,
    pushStack = false,
    model = this.editor.getActiveCodeEditor().getModel()
  ) => {
    const results = [];
    let index = 0;
    for (let i = 0; i < operation.ops.length; i++) {
      const op = operation.ops[i];
      if (TextOperation.isRetain(op)) {
        index += op;
      } else if (TextOperation.isInsert(op)) {
        const { lineNumber, column } = indexToLineAndColumn(
          model.getLinesContent() || [],
          index
        );
        const range = new this.monaco.Range(
          lineNumber,
          column,
          lineNumber,
          column
        );
        results.push({
          range,
          text: op,
          forceMoveMarkers: true,
        });
      } else if (TextOperation.isDelete(op)) {
        const lines = model.getLinesContent() || [];
        const from = indexToLineAndColumn(lines, index);
        const to = indexToLineAndColumn(lines, index - op);
        results.push({
          range: new this.monaco.Range(
            from.lineNumber,
            from.column,
            to.lineNumber,
            to.column
          ),
          text: '',
        });
        index -= op;
      }
    }

    this.receivingCode = true;
    if (pushStack) {
      model.pushEditOperations([], results);
    } else {
      model.applyEdits(results);
    }
    this.receivingCode = false;
  };

  applyOperations = (operations: { [moduleShortid: string]: any }) => {
    const operationsJSON = operations.toJSON();

    Object.keys(operationsJSON).forEach(moduleShortid => {
      const operation = TextOperation.fromJSON(operationsJSON[moduleShortid]);

      if (moduleShortid !== this.currentModule.shortid) {
        // Apply the code to the current module code itself
        const module = this.sandbox.modules.find(
          m => m.shortid === moduleShortid
        );

        if (!module) {
          return;
        }

        const code = operation.apply(module.code || '');
        if (this.props.onChange) {
          this.props.onChange(code, module.shortid);
        }
        return;
      }

      this.liveOperationCode = '';
      this.applyOperationToModel(operation);
    });
  };

  changeDependencies = (
    dependencies: ?$PropertyType<Props, 'dependencies'>
  ) => {
    this.dependencies = dependencies;
  };

  changeSettings = (settings: $PropertyType<Props, 'settings'>) => {
    this.settings = settings;
    if (settings.lintEnabled && !this.lintWorker) {
      this.setupLintWorker();
    }

    this.editor.getActiveCodeEditor().updateOptions(this.getEditorOptions());
    this.forceUpdate();
  };

  setErrors = (errors: Array<ModuleError>) => {
    const activeEditor = this.editor.getActiveCodeEditor();

    if (activeEditor) {
      if (errors.length > 0) {
        const thisModuleErrors = errors.filter(
          error => error.moduleId === this.currentModule.id
        );
        const errorMarkers = thisModuleErrors
          .map(error => {
            if (error) {
              return {
                severity: this.monaco.MarkerSeverity.Error,
                startColumn: 1,
                startLineNumber: error.line,
                endColumn: error.column,
                endLineNumber: error.line + 1,
                message: error.message,
              };
            }

            return null;
          })
          .filter(x => x);

        this.monaco.editor.setModelMarkers(
          activeEditor.getModel(),
          'error',
          errorMarkers
        );
      } else {
        this.monaco.editor.setModelMarkers(
          activeEditor.getModel(),
          'error',
          []
        );
      }
    }
  };

  setCorrections = (corrections: Array<ModuleCorrection>) => {
    const activeEditor = this.editor.getActiveCodeEditor();
    if (activeEditor) {
      if (corrections.length > 0) {
        const correctionMarkers = corrections
          .filter(correction => correction.moduleId === this.currentModule.id)
          .map(correction => {
            if (correction) {
              return {
                severity:
                  correction.severity === 'warning'
                    ? this.monaco.MarkerSeverity.Warning
                    : this.monaco.MarkerSeverity.Notice,
                startColumn: correction.column,
                startLineNumber: correction.line,
                endColumn: 1,
                endLineNumber: correction.line + 1,
                message: correction.message,
                source: correction.source,
              };
            }

            return null;
          })
          .filter(x => x);

        this.monaco.editor.setModelMarkers(
          activeEditor.getModel(),
          'correction',
          correctionMarkers
        );
      } else {
        this.monaco.editor.setModelMarkers(
          activeEditor.getModel(),
          'correction',
          []
        );
      }
    }
  };

  setGlyphs = (glyphs: Array<{ line: number, className: string }>) => {
    if (glyphs.length > 0) {
      const glyphMarkers = glyphs
        .map(glyph => {
          if (glyph) {
            return {
              range: new this.monaco.Range(glyph.line, 1, glyph.line, 1),
              options: {
                isWholeLine: true,
                glyphMarginClassName: glyph.className,
              },
            };
          }

          return null;
        })
        .filter(x => x);

      this.editor.getActiveCodeEditor().deltaDecorations([], glyphMarkers);
    } else {
      this.editor.getActiveCodeEditor().deltaDecorations([], []);
    }
  };

  registerAutoCompletions = () => {
    this.monaco.languages.registerCompletionItemProvider('typescript', {
      triggerCharacters: ['"', "'", '.'],
      provideCompletionItems: (model, position) => {
        // Get editor content before the pointer
        const textUntilPosition = model.getValueInRange(
          {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
          1
        );

        if (
          /(([\s|\n]from\s)|(\brequire\b\())["|']\.*$/.test(textUntilPosition)
        ) {
          // It's probably a `import` statement or `require` call
          if (textUntilPosition.endsWith('.')) {
            // User is trying to import a file
            const prefix = textUntilPosition.match(/[./]+$/)[0];

            const modulesByPath = new WeakMap();
            this.sandbox.modules.forEach(module => {
              const path =
                '/sandbox' +
                getModulePath(
                  this.sandbox.modules,
                  this.sandbox.directories,
                  module.id
                );

              modulesByPath.set(
                module,
                path.indexOf('/') === -1 ? '/' + path : path
              );
            });

            const currentModulePath = modulesByPath.get(this.currentModule);
            if (!currentModulePath) {
              return null;
            }

            const relativePath = join(dirname(currentModulePath), prefix);
            return this.sandbox.modules
              .filter(m => {
                const path = modulesByPath.get(m);

                return (
                  path &&
                  m.id !== this.currentModule.id &&
                  path.startsWith(relativePath)
                );
              })
              .map(module => {
                let path = modulesByPath.get(module);

                if (!path) return null;

                // Don't keep extension for JS files
                if (path.endsWith('.js')) {
                  path = path.replace(/\.js$/, '');
                }

                // Don't keep extension for TS files
                if (path.endsWith('.ts')) {
                  path = path.replace(/\.ts$/, '');
                }

                return {
                  label:
                    prefix +
                    path.replace(relativePath, relativePath === '/' ? '/' : ''),
                  insertText: path.slice(
                    relativePath === '/' ? 0 : relativePath.length
                  ),
                  kind: this.monaco.languages.CompletionItemKind.File,
                };
              })
              .filter(Boolean);
          }
          const deps = this.dependencies;
          if (deps) {
            // User is trying to import a dependency
            return Object.keys(deps).map(name => ({
              label: name,
              detail: deps[name],
              kind: this.monaco.languages.CompletionItemKind.Module,
            }));
          }

          return [];
        }
        return [];
      },
    });
  };

  setupLintWorker = () => {
    if (!this.lintWorker) {
      this.lintWorker = new LinterWorker();

      this.lintWorker.addEventListener('message', event => {
        const { markers, version } = event.data;

        requestAnimationFrame(() => {
          const activeEditor = this.editor.getActiveCodeEditor();
          if (activeEditor && activeEditor.getModel()) {
            if (version === activeEditor.getModel().getVersionId()) {
              this.updateLintWarnings(markers);
            } else {
              this.updateLintWarnings([]);
            }
          }
        });
      });

      this.lint = debounce(this.lint, 400);

      if (this.editor.getActiveCodeEditor()) {
        this.lint(
          this.getCode(),
          this.currentModule.title,
          this.editor
            .getActiveCodeEditor()
            .getModel()
            .getVersionId()
        );
      }
    }
  };

  setupWorkers = () => {
    const settings = this.settings;

    if (settings.lintEnabled) {
      // Delay this one, as initialization is very heavy
      setTimeout(() => {
        this.setupLintWorker();
      }, 5000);
    }
  };

  updateDecorations = async (classifications: Array<Object>) => {
    const decorations = classifications.map(classification => ({
      range: new this.monaco.Range(
        classification.startLine,
        classification.start,
        classification.endLine,
        classification.end
      ),
      options: {
        inlineClassName: classification.type
          ? `${classification.kind} ${classification.type}-of-${
              classification.parentKind
            }`
          : classification.kind,
      },
    }));

    const currentModule = this.currentModule;
    const modelInfo = await this.getModelById(currentModule.id);

    modelInfo.decorations = this.editor
      .getActiveCodeEditor()
      .deltaDecorations(modelInfo.decorations || [], decorations);
  };

  getModelById = (id: string) => {
    const modulePath = getModulePath(
      this.sandbox.modules,
      this.sandbox.directories,
      id
    );

    const uri = this.monaco.Uri.file('/sandbox' + modulePath);
    return this.editor.textFileService.modelService.getModel(uri);
  };

  updateLintWarnings = async (markers: Array<Object>) => {
    const currentModule = this.currentModule;

    const mode = await getMode(currentModule.title, this.monaco);
    if (mode === 'javascript' || mode === 'vue') {
      this.monaco.editor.setModelMarkers(
        this.editor.getActiveCodeEditor().getModel(),
        'eslint',
        markers
      );
    }
  };

  getCurrentModelPath = () => {
    const activeEditor = this.editor.getActiveCodeEditor();

    if (!activeEditor) {
      return undefined;
    }
    const model = activeEditor.getModel();
    if (!model) {
      return undefined;
    }

    return model.uri.path.replace(/^\/sandbox/, '');
  };

  openModule = (module: Module) => {
    if (module.id) {
      const path = getModulePath(
        this.sandbox.modules,
        this.sandbox.directories,
        module.id
      );

      if (this.getCurrentModelPath() !== path) {
        this.editor.openFile(path);
      }
    }
  };

  swapDocuments = (currentModule: Module, nextModule: Module) => {
    this.openModule(nextModule);
  };

  updateCode(code: string = '') {
    const operation = getTextOperation(this.getCode(), code);

    if (!this.receivingCode) {
      // For the live operation we need to send the operation based on the old code,
      // that's why we set the 'liveOperationCode' to the last code so the operation
      // will be applied on that code instead of `currentModule.code`
      this.liveOperationCode = this.getCode();
    }

    this.applyOperationToModel(operation, true);
  }

  lint = async (code: string, title: string, version: number) => {
    if (!title) {
      return;
    }

    const mode = await getMode(title, this.monaco);
    if (this.settings.lintEnabled) {
      if (mode === 'javascript' || mode === 'vue') {
        if (this.lintWorker) {
          this.lintWorker.postMessage({
            code,
            title,
            version,
            template: this.sandbox.template,
          });
        }
      }
    }
  };

  handleChange = (currentModuleShortid, currentModuleTitle) => {
    const newCode =
      this.editor
        .getActiveCodeEditor()
        .getModel()
        .getValue(1) || '';

    if (this.props.onChange) {
      this.props.onChange(newCode, currentModuleShortid);
    }

    this.lint(
      newCode,
      currentModuleTitle,
      this.editor
        .getActiveCodeEditor()
        .getModel()
        .getVersionId()
    );
  };

  hasNativeTypescript = () => {
    const sandbox = this.sandbox;
    const template = getTemplate(sandbox.template);
    return template.isTypescript;
  };

  fetchedSchemas = {};
  getConfigSchemas = async () => {
    const sandbox = this.sandbox;
    const template = getTemplate(sandbox.template);

    const configurations = template.configurationFiles;
    // $FlowIssue
    const schemas: Array<{
      fileName: string,
      schema: Object,
      uri: string,
    }> = (await Promise.all(
      Object.keys(configurations).map(async p => {
        const config = configurations[p];

        if (this.fetchedSchemas[config.title]) {
          return null;
        }

        if (config.schema) {
          try {
            const schema = await fetch(config.schema).then(x => x.json());
            return { fileName: config.title, schema, uri: config.schema };
          } catch (e) {
            return null;
          }
        }
        return null;
      })
    )).filter(x => x);

    const monacoSchemas = schemas.map(data => {
      this.fetchedSchemas[data.fileName] = true;

      return {
        uri: data.uri,
        fileMatch: [data.fileName],
        schema: data.schema,
      };
    });

    this.monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      schemas: [
        ...this.monaco.languages.json.jsonDefaults._diagnosticsOptions.schemas,
        ...monacoSchemas,
      ],
    });
  };

  resizeEditor = () => {
    this.resizeEditorInstantly();
  };

  resizeEditorInstantly = () => {
    this.forceUpdate(() => {
      if (this.editor) {
        this.editor.editorPart.layout({
          width: this.props.width,
          height: this.props.height,
        });
      }
    });
  };

  addLib = (code: string, path: string) => {
    const fullPath = `file://${path}`;

    const existingLib = this.monaco.languages.typescript.javascriptDefaults.getExtraLibs()[
      fullPath
    ];
    // Only add it if it has been added before, we don't care about the contents
    // of the libs, only if they've been added.

    if (!existingLib) {
      // We add it manually, and commit the changes manually
      // eslint-disable-next-line no-underscore-dangle
      this.monaco.languages.typescript.javascriptDefaults._extraLibs[
        fullPath
      ] = code;
      this.commitLibChanges();
    }
  };

  /**
   * We manually commit lib changes, because if do this for *every* change we will
   * reload the whole TS worker & AST for every change. This method is debounced
   * by 300ms.
   */
  commitLibChanges = () => {
    // eslint-disable-next-line no-underscore-dangle
    this.monaco.languages.typescript.javascriptDefaults._onDidChange.fire(
      this.monaco.languages.typescript.javascriptDefaults
    );

    this.monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: !this.hasNativeTypescript(),
    });
  };

  getCode = () => {
    const activeEditor = this.editor.getActiveCodeEditor();
    if (!activeEditor) return '';

    return activeEditor.getValue({
      lineEnding: '\n',
    });
  };

  handleSaveCode = async () => {
    const onSave = this.props.onSave;
    if (onSave) {
      onSave(this.getCode() || '');
    }
  };

  getEditorOptions = () => {
    const settings = this.settings;
    const currentModule = this.currentModule;

    return {
      ...getSettings(settings),
      ariaLabel: currentModule.title,
      readOnly: !!this.props.readOnly,
    };
  };

  render() {
    const { width, height } = this.props;

    const options = this.getEditorOptions();

    return (
      <Container id="vscode-container">
        <MonacoEditorComponent
          width={width}
          height={height}
          theme="CodeSandbox"
          options={options}
          editorDidMount={this.configureEditor}
          editorWillMount={monaco =>
            defineTheme(monaco, this.props.theme.vscodeTheme)
          }
          getEditorOptions={this.getEditorOptions}
        />
      </Container>
    );
  }
}

export default withTheme(MonacoEditor);
