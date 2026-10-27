// Empty on purpose: built for WebAssembly as a reactor, the module never runs main; the page
// calls the functions in Exports.swift after _initialize. (Globals there start lazily, as they
// would not here.) On a Mac this builds an executable that does nothing.
