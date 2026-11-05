function trustedPreventFetch(...args) {
    preventFetchFn(true, ...args);
}