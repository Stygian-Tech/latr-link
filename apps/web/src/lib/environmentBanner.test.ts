import { afterEach, describe, expect, it } from "bun:test";

import {
  environmentBannerOffset,
  getAppEnv,
  isEnvironmentBannerShown,
} from "./environmentBanner";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
});

describe("getAppEnv", () => {
  it("prefers NEXT_PUBLIC_APP_ENV", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "dev";
    process.env.APP_ENV = "local";
    expect(getAppEnv()).toBe("dev");
  });

  it("falls back to APP_ENV", () => {
    delete process.env.NEXT_PUBLIC_APP_ENV;
    process.env.APP_ENV = "local";
    expect(getAppEnv()).toBe("local");
  });

  it("normalizes production alias", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "production";
    expect(getAppEnv()).toBe("prod");
  });
});

describe("environment banner helpers", () => {
  it("shows banner for dev and local only", () => {
    expect(isEnvironmentBannerShown("dev")).toBe(true);
    expect(isEnvironmentBannerShown("local")).toBe(true);
    expect(isEnvironmentBannerShown("prod")).toBe(false);
  });

  it("sets offset when banner is shown", () => {
    expect(environmentBannerOffset("prod")).toBe("0px");
    expect(environmentBannerOffset("dev")).toBe("2.375rem");
  });
});
