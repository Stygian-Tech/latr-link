import { afterEach, describe, expect, it } from "bun:test";

import {
  bannerMessage,
  environmentBannerOffset,
  getAppEnv,
  isEnvironmentBannerShown,
  showSaveOutcomeDebugLabels,
} from "./environmentBanner";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
});

describe("Get App Env", () => {
  it("Prefers NEXT_PUBLIC_APP_ENV", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "dev";
    process.env.APP_ENV = "local";
    expect(getAppEnv()).toBe("dev");
  });

  it("Falls Back to APP_ENV", () => {
    delete process.env.NEXT_PUBLIC_APP_ENV;
    process.env.APP_ENV = "local";
    expect(getAppEnv()).toBe("local");
  });

  it("Normalizes Production Alias", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "production";
    expect(getAppEnv()).toBe("prod");
  });
});

describe("Environment Banner Helpers", () => {
  it("Shows Banner for Dev, Local, and Test", () => {
    expect(isEnvironmentBannerShown("dev")).toBe(true);
    expect(isEnvironmentBannerShown("local")).toBe(true);
    expect(isEnvironmentBannerShown("test")).toBe(true);
    expect(isEnvironmentBannerShown("prod")).toBe(false);
  });

  it("Sets Offset When Banner Is Shown", () => {
    expect(environmentBannerOffset("prod")).toBe("0px");
    expect(environmentBannerOffset("dev")).toBe("2.625rem");
  });

  it("Includes Test in Banner Copy", () => {
    expect(bannerMessage("test")).toContain("Testing Server");
  });

  it("Enables Save Debug Labels for Test Env", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    expect(showSaveOutcomeDebugLabels()).toBe(true);
  });
});
