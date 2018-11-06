import styled, { css } from 'styled-components';

export const Container = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;

  max-height: 100%;
  z-index: 100;
  background-color: ${props =>
    props.theme['statusBar.background'] || props.theme.background2};
`;

export const Header = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  font-size: 0.875rem;
  height: 2rem;
  min-height: 2rem;
  background-color: ${props =>
    props.theme['statusBar.background'] || props.theme.background4};
  color: ${props =>
    props.theme['statusBar.foreground'] || 'rgba(255, 255, 255, 0.8)'};
  border-bottom: 1px solid
    ${props => props.theme['statusBar.border'] || 'rgba(0, 0, 0, 0.3)'};

  box-shadow: 0 0 3px rgba(0, 0, 0, 0.3);

  cursor: row-resize;
  flex-direction: row;
`;

export const Tab = styled.div`
  transition: 0.2s ease color;
  display: flex;
  align-items: center;
  height: calc(2rem - 1px);
  padding: 0 1rem;
  background-color: transparent;
  border-right: 1px solid
    ${props => props.theme['statusBar.border'] || 'rgba(0, 0, 0, 0.3)'};
  border-bottom: 1px solid transparent;

  cursor: pointer;

  color: ${props =>
    props.theme['statusBar.foreground'] || 'rgba(255, 255, 255, 0.6)'};
  font-weight: 600;

  ${props =>
    props.active
      ? css`
          color: ${props.theme['statusBar.foreground'] ||
            'rgba(255, 255, 255, 1)'};
          background-color: ${props.theme['editor.background']
            ? 'transparent'
            : props.theme.background};
          border-bottom-color: ${props.theme['editor.background']
            ? 'transparent'
            : props.theme.background};
        `
      : css`
          &:hover {
            color: ${props.theme['statusBar.foreground'] ||
              'rgba(255, 255, 255, 1)'};
          }
        `};
`;

export const Actions = styled.div`
  position: absolute;
  right: 1rem;
  font-size: 1.125rem;

  svg {
    margin: 0 0.5rem;

    transition: 0.3s ease all;

    cursor: pointer;
    color: ${props =>
      props.theme.light ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.7)'};

    &:hover {
      color: white;
    }
  }
`;
