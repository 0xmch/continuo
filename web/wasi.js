// The little of WASI (the WebAssembly system interface) the band's module needs in a page:
// clocks, random numbers, and stdout/stderr to the console. Files, sockets and the rest answer
// "not supported", which the Swift runtime takes in its stride.
export function wasi(memory, log = console.log) {
  const ENOSYS = 52, EBADF = 8;
  const view = () => new DataView(memory().buffer);
  const text = new TextDecoder();
  const pending = { 1: "", 2: "" };
  const calls = {
    args_sizes_get: (count, size) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
    args_get: () => 0,
    environ_sizes_get: (count, size) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
    environ_get: () => 0,
    clock_res_get: (id, out) => { view().setBigUint64(out, 1000n, true); return 0; },
    clock_time_get: (id, precision, out) => {
      const ms = id === 0 ? Date.now() : performance.now();
      view().setBigUint64(out, BigInt(Math.round(ms * 1e6)), true);
      return 0;
    },
    random_get: (at, length) => {
      for (let i = 0; i < length; i += 65536) crypto.getRandomValues(new Uint8Array(memory().buffer, at + i, Math.min(65536, length - i)));
      return 0;
    },
    fd_write: (fd, iovs, count, written) => {
      const v = view();
      let total = 0;
      for (let i = 0; i < count; i++) {
        const at = v.getUint32(iovs + i * 8, true), length = v.getUint32(iovs + i * 8 + 4, true);
        if (fd === 1 || fd === 2) pending[fd] += text.decode(new Uint8Array(memory().buffer, at, length));
        total += length;
      }
      for (const fd of [1, 2]) {
        const lines = pending[fd].split("\n");
        pending[fd] = lines.pop();
        for (const line of lines) log(line);
      }
      v.setUint32(written, total, true);
      return 0;
    },
    fd_fdstat_get: (fd, out) => {
      if (fd > 2) return EBADF;
      for (let i = 0; i < 24; i++) view().setUint8(out + i, 0);
      view().setUint8(out, 2);   // a character device
      return 0;
    },
    fd_prestat_get: () => EBADF,
    proc_exit: (code) => { throw new Error(`the module exited (${code})`); },
  };
  return new Proxy(calls, { get: (target, name) => target[name] ?? (() => ENOSYS) });
}
