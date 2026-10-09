// Unit tests never reach the network: a test that needs fetch stubs it (vi.stubGlobal), and any
// call that slips through fails loudly instead of hitting a real, possibly paid, service.
globalThis.fetch = async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new Error(`network is blocked in unit tests: ${url}`);
};
