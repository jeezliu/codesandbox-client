import React from 'react';
import FontFaceObserver from 'fontfaceobserver';

import controller from 'app/controller';
import './icon-theme.css';
import './workbench-theme.css';

function noop() {}

export type EditorAPI = {
  openFile(path: string): any,
  getActiveCodeEditor(): any,
  editorPart: any,
  textFileService: any,
  editorService: any,
};

const fontPromise = new FontFaceObserver('dm').load().catch(() => {});

let serviceCache;
let editorPart;

class MonacoEditor extends React.PureComponent {
  constructor(props) {
    super(props);
    this.containerElement = undefined;
  }

  componentDidMount() {
    this.afterViewInit();
  }

  componentWillUnmount() {
    this.destroyMonaco();
  }

  editorWillMount = monaco => {
    const { editorWillMount } = this.props;
    editorWillMount(monaco);
  };

  editorDidMount = (editor, monaco) => {
    this.props.editorDidMount(editor, monaco);
  };

  afterViewInit = () => {
    // eslint-disable-next-line global-require
    require('app/vscode/dev-bootstrap').default([
      'vs/editor/codesandbox.editor.main',
    ])(() => {
      this.initMonaco();
    });
  };

  initializeEditor(container, cb) {
    if (serviceCache) {
      cb(serviceCache);
      return;
    }

    const context = this.props.context || window;
    const [{ CodeSandboxService }] = [
      window.require(
        'vs/codesandbox/services/codesandbox/browser/codesandboxService'
      ),
    ];

    context.monaco.editor.create(
      container,
      {},
      {
        codesandboxService: i =>
          i.createInstance(CodeSandboxService, controller),
      },
      returnedServices => {
        serviceCache = returnedServices;
        cb(serviceCache);
      }
    );
  }

  initMonaco = () => {
    const { theme } = this.props;
    const context = this.props.context || window;
    if (this.containerElement && typeof context.monaco !== 'undefined') {
      // Before initializing monaco editor
      this.editorWillMount(context.monaco);

      window.monacoCodeSandbox = {
        openModel: model => this.props.openReference(model),
      };

      const r = context.require;

      const [
        { IEditorService },
        { ICodeEditorService },
        { ITextFileService },
        { ILifecycleService },
        { IEditorGroupsService },
      ] = [
        r('vs/workbench/services/editor/common/editorService'),
        r('vs/editor/browser/services/codeEditorService'),
        r('vs/workbench/services/textfile/common/textfiles'),
        r('vs/platform/lifecycle/common/lifecycle'),
        r('vs/workbench/services/group/common/editorGroupsService'),
      ];

      document.getElementById('root').className += ' monaco-shell vs-dark';

      const container = document.createElement('div');
      const part = document.createElement('div');
      container.appendChild(part);

      const rootEl = document.getElementById('vscode-container');
      rootEl.appendChild(container);

      this.initializeEditor(container, services => {
        const editorElement = document.getElementById(
          'workbench.main.container'
        );

        container.className = 'monaco-workbench';
        part.className = 'part editor has-watermark';
        editorElement.className += ' monaco-workbench mac nopanel';

        const EditorPart = services.get(IEditorGroupsService);

        if (editorPart) {
          editorPart.parent = part;
          editorPart = EditorPart;
        } else {
          EditorPart.create(part);
        }

        EditorPart.layout({
          width: this.props.width,
          height: this.props.height,
        });

        const codeEditorService = services.get(ICodeEditorService);
        const textFileService = services.get(ITextFileService);
        const editorService = services.get(IEditorService);
        const lifecycleService = services.get(ILifecycleService);

        lifecycleService.phase = 3; // Running

        const editorApi = {
          openFile(path: string) {
            fontPromise.then(() => {
              codeEditorService.openCodeEditor({
                resource: context.monaco.Uri.file('/sandbox' + path),
              });
            });
          },
          getActiveCodeEditor() {
            return codeEditorService.getActiveCodeEditor();
          },
          textFileService,
          editorPart: EditorPart,
          editorService,
        };
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line
          console.log(services);
        }

        this.editor = editorApi;

        // After initializing monaco editor
        this.editorDidMount(editorApi, context.monaco);
      });

      // TODO: move this to a better place
      if (theme) {
        context.monaco.editor.setTheme(theme);
      }
    }
  };

  destroyMonaco = () => {
    const groupsToClose = this.editor.editorService.editorGroupService.getGroups();

    Promise.all(groupsToClose.map(g => g.closeAllEditors()))
      .then(() => {
        groupsToClose.forEach(group =>
          this.editor.editorService.editorGroupService.removeGroup(group)
        );
      })
      .then(() => {
        this.editor.editorPart.shutdown();
      });
  };

  assignRef = component => {
    this.containerElement = component;
  };

  render() {
    const { width, height } = this.props;
    const fixedWidth =
      width && width.toString().indexOf('%') !== -1 ? width : `${width}px`;
    const fixedHeight =
      height && height.toString().indexOf('%') !== -1 ? height : `${height}px`;
    const style = {
      width: fixedWidth,
      height: fixedHeight,
      overflow: 'hidden',
      position: 'absolute',
    };

    return (
      <div
        ref={this.assignRef}
        style={style}
        className="react-monaco-editor-container"
      />
    );
  }
}

MonacoEditor.defaultProps = {
  width: '100%',
  height: '100%',
  theme: null,
  options: {},
  editorDidMount: noop,
  editorWillMount: noop,
  onChange: noop,
  template: '',
  requireConfig: {},
};

export default MonacoEditor;
