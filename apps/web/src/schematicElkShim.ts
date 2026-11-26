// Inside a worker elk.bundled.js takes over `self.onmessage` and exports no in-thread
// ELK worker, so `new ELK()` fails. A document stub makes it export that worker instead.
const scope = globalThis as { document?: unknown };
scope.document ??= {};
