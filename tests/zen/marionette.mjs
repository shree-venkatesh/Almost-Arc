// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// A minimal Marionette client (Firefox's automation protocol: "<length>:<json>"
// messages over TCP), enough to run scripts in Zen's chrome. No dependencies.

import net from "node:net";

export class Marionette {
  #sock = null;
  #buf = Buffer.alloc(0);
  #waiting = new Map();
  #hello = null;
  #id = 0;

  /** Connects, retrying until Zen's Marionette server is up (or timeoutMs passes). */
  async connect(port = 2828, timeoutMs = 60000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      try {
        await this.#open(port);
        await this.#hello;
        return this;
      } catch (e) {
        if (Date.now() > until) throw new Error(`no Marionette on port ${port}: ${e.message}`);
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  #open(port) {
    return new Promise((resolve, reject) => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("error", reject);
      sock.once("connect", () => {
        sock.off("error", reject);
        sock.on("error", e => this.#failAll(e));
        sock.on("close", () => this.#failAll(new Error("Marionette connection closed")));
        this.#sock = sock;
        this.#buf = Buffer.alloc(0);
        this.#hello = new Promise((res, rej) => this.#waiting.set("hello", { res, rej }));
        sock.on("data", d => this.#read(d));
        resolve();
      });
    });
  }

  #failAll(e) {
    for (const w of this.#waiting.values()) w.rej(e);
    this.#waiting.clear();
  }

  #read(data) {
    this.#buf = Buffer.concat([this.#buf, data]);
    for (;;) {
      const colon = this.#buf.indexOf(":");
      if (colon < 0) return;
      const len = Number(this.#buf.subarray(0, colon).toString());
      if (this.#buf.length < colon + 1 + len) return;
      const msg = JSON.parse(this.#buf.subarray(colon + 1, colon + 1 + len).toString());
      this.#buf = this.#buf.subarray(colon + 1 + len);
      if (!Array.isArray(msg)) {                 // the greeting
        this.#waiting.get("hello")?.res(msg);
        this.#waiting.delete("hello");
        continue;
      }
      const [, id, error, result] = msg;
      const w = this.#waiting.get(id);
      if (!w) continue;
      this.#waiting.delete(id);
      if (error) w.rej(new Error(`${error.error}: ${error.message}${error.stacktrace ? "\n" + error.stacktrace : ""}`));
      else w.res(result);
    }
  }

  send(name, params = {}) {
    const id = ++this.#id;
    const body = Buffer.from(JSON.stringify([0, id, name, params]));
    return new Promise((res, rej) => {
      this.#waiting.set(id, { res, rej });
      this.#sock.write(`${body.length}:`);
      this.#sock.write(body);
    });
  }

  async session() {
    await this.send("WebDriver:NewSession", { capabilities: {} });
    await this.send("Marionette:SetContext", { value: "chrome" });
    await this.send("WebDriver:SetTimeouts", { script: 120000 });
  }

  /** Runs `body` (an async function's body, `args` as `args`) in the current chrome window. */
  async run(body, args = []) {
    const script = `const all = [...arguments]; const resolve = all.pop(); const args = all;
      (async () => { ${body} })().then(v => resolve({ ok: true, v }), e => resolve({ ok: false, e: String(e) + "\\n" + (e?.stack || "") }));`;
    const r = await this.send("WebDriver:ExecuteAsyncScript", { script, args });
    const out = r?.value ?? r;
    if (!out?.ok) throw new Error(out?.e || "script failed");
    return out.v;
  }

  async quit() {
    try { await this.send("Marionette:Quit", { flags: ["eForceQuit"] }); } catch (e) {}
    try { this.#sock?.destroy(); } catch (e) {}
  }
}
