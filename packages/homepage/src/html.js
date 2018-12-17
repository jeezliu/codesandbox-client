import React, { Component } from 'react';

// eslint-disable-next-line react/prefer-stateless-function
export default class HTML extends Component {
  render() {
    return (
      <html lang="en">
        <head>
          {this.props.headComponents}

          <meta name="referrer" content="origin" />
          <meta charSet="utf-8" />
          <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <meta property="og:type" content="website" />
          <meta property="og:author" content="https://ivesvh.com" />
          <meta name="theme-color" content="#6CAEDD" />
          <meta
            property="og:image"
            content="https://codesandbox.io/static/img/banner.png"
          />
          <meta property="og:image:width" content="1200" />

          <meta property="og:image:height" content="630" />
          <meta property="twitter:card" content="summary_large_image" />
          <meta property="twitter:site" content="@CompuIves" />
          <meta property="twitter:creator" content="@CompuIves" />
          <meta
            property="twitter:image:src"
            content="https://codesandbox.io/static/img/banner.png"
          />
          <meta property="twitter:image:width" content="1200" />
          <meta property="twitter:image:height" content="630" />
        </head>
        <body>
          <div
            id="___gatsby"
            dangerouslySetInnerHTML={{ __html: this.props.body }}
          />
          {this.props.postBodyComponents}
        </body>
      </html>
    );
  }
}
