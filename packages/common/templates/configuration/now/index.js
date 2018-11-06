// @flow
import type { ConfigurationFile } from '../types';

const config: ConfigurationFile = {
  title: 'now.json',
  type: 'now',
  description: 'Configuration for your deployments on now.',
  moreInfoUrl: 'https://zeit.co/docs/features/configuration',

  getDefaultCode: () =>
    JSON.stringify(
      {
        type: 'NPM',
      },
      null,
      2
    ),
};

export default config;
