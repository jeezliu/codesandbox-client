import styled from 'styled-components';

export const PrivacySelect = styled.select`
  background-color: ${props =>
    props.theme['dropdown.background'] || 'rgba(0, 0, 0, 0.3)'};
  color: ${props =>
    props.theme['dropdown.foreground'] ||
    (props.theme.light ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)')};
  border-radius: 4px;
  margin: 0.25rem;
  margin-bottom: 1rem;
  height: 2rem;
  width: 100%;
  border: none;
  box-sizing: border-box;
`;

export const PatronMessage = styled.div`
  margin: 0.5rem 1rem;
  color: ${props =>
    props.theme.light ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.8)'};
  font-size: 0.875rem;
`;

export const CenteredText = styled.div`
  display: inline-flex;
  justify-content: center;
  align-items: center;
  flex-direction: row;

  svg {
    opacity: 0.8;
    margin-right: 0.25rem;
  }
`;
