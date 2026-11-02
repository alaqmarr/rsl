import { describe, expect, it } from "vitest";
import { parseAgentCliFlags } from "../index";

describe("Tally Windows Connector Agent CLI Parser", () => {
  it("parses space-separated flags (--pair, --server, --device, --tally-port, --doctor)", () => {
    const flags = parseAgentCliFlags([
      "--pair",
      "RSL-ABC123-DEF456",
      "--server",
      "https://app.rapidshiftlabs.in",
      "--device",
      "Accounts Office PC",
      "--tally-host",
      "127.0.0.1",
      "--tally-port",
      "9000",
      "--once",
    ]);

    expect(flags.pair).toBe("RSL-ABC123-DEF456");
    expect(flags.server).toBe("https://app.rapidshiftlabs.in");
    expect(flags.device).toBe("Accounts Office PC");
    expect(flags["tally-host"]).toBe("127.0.0.1");
    expect(flags["tally-port"]).toBe("9000");
    expect(flags.once).toBe("true");
  });

  it("parses equals-delimited flags (--code=..., --server=..., --doctor)", () => {
    const flags = parseAgentCliFlags([
      "--code=RSL-777888-999000",
      "--server=https://shree-traders.tally.rapidshiftlabs.in",
      "--doctor",
    ]);

    expect(flags.code).toBe("RSL-777888-999000");
    expect(flags.server).toBe("https://shree-traders.tally.rapidshiftlabs.in");
    expect(flags.doctor).toBe("true");
  });
});
