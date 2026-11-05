function trustedReplaceFetchResponse(...args) {
    replaceFetchResponseFn(true, ...args);
}