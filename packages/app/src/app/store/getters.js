export function isPatron(state) {
  return Boolean(
    state.user && state.user.subscription && state.user.subscription.since
  );
}

export function isLoggedIn(state) {
  return Boolean(state.jwt) && Boolean(state.user);
}
