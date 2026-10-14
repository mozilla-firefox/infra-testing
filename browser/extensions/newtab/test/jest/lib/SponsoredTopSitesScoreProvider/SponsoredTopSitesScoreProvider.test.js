/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { stubGlobals } from "test/jest/test-utils";

describe("SponsoredTopSitesScoreProvider", () => {
  let SponsoredTopSitesScoreProvider;
  let restoreChromeUtils;
  let restoreGlobals;
  let rsFactory;
  let rsClient;
  let executePlacesQuery;
  let cacheStore;
  let prefStore;
  let getFlags;
  let provider;

  const PREF_LAST_TIME =
    "browser.newtabpage.activity-stream.sponsoredTopSitesScoring.lastReleaseTime";

  beforeAll(async () => {
    restoreChromeUtils = stubGlobals({
      ChromeUtils: {
        defineESModuleGetters: object => {
          Object.setPrototypeOf(object, globalThis);
          return globalThis;
        },
        importESModule: () => globalThis,
      },
    });
    ({ SponsoredTopSitesScoreProvider } =
      await import("lib/SponsoredTopSitesScoreProvider/SponsoredTopSitesScoreProvider.mjs"));
  });

  afterAll(() => {
    restoreChromeUtils();
  });

  beforeEach(() => {
    jest.useFakeTimers();
    rsClient = {
      get: jest.fn().mockResolvedValue([]),
    };
    rsFactory = jest.fn(() => rsClient);
    executePlacesQuery = jest.fn().mockResolvedValue([]);
    cacheStore = {};
    prefStore = {};
    getFlags = jest.fn().mockReturnValue({});
    restoreGlobals = stubGlobals({
      RemoteSettings: rsFactory,
      Services: {
        prefs: {
          getIntPref: (name, def) =>
            name in prefStore ? prefStore[name] : def,
          setIntPref: (name, value) => {
            prefStore[name] = value;
          },
        },
      },
      PersistentCache: class {
        async get(key) {
          return key ? cacheStore[key] : cacheStore;
        }
        async set(key, value) {
          cacheStore[key] = value;
        }
      },
      PlacesUtils: {
        getReversedHost: url => `${url.host.split("").reverse().join("")}.`,
        history: { TRANSITIONS: { LINK: 1, TYPED: 2, BOOKMARK: 3 } },
      },
      NewTabUtils: {
        activityStreamProvider: { executePlacesQuery },
      },
    });
    provider = new SponsoredTopSitesScoreProvider(getFlags);
  });

  afterEach(() => {
    restoreGlobals();
    jest.useRealTimers();
  });

  const RECORD_ID = "sponsored_top_site_scoring";

  // A raw Remote Settings record that passes validation.
  const VALID_RECORD = {
    id: RECORD_ID,
    targets: { t1: ["example.com"] },
    lookback_days: 28,
    recency_halflife_days: 7,
    trend_days: 30,
    allowed_targets: 2,
    decimals: 1,
    privacy_parameter: 50,
    repeat_visit_weight: 80,
    normalization_cap: 150,
  };

  it("constructs with no scores", async () => {
    expect(provider).toBeInstanceOf(SponsoredTopSitesScoreProvider);
    expect(await provider.getScores()).toEqual({});
  });

  describe("#init", () => {
    it("creates the Remote Settings client and starts the refresh timer", async () => {
      getFlags.mockReturnValue({ [RECORD_ID]: true });
      rsClient.get.mockResolvedValue([{ id: RECORD_ID }]);

      await provider.init();

      expect(rsFactory).toHaveBeenCalledWith(
        "newtab-sponsored-topsites-scoring"
      );
      expect(provider._refreshTimer).not.toBeNull();
    });

    it("restores persisted scores from the cache", async () => {
      cacheStore.scores = { "example.com": 5 };
      jest
        .spyOn(provider, "_getLastReleaseTime")
        .mockReturnValue(Math.round(Date.now() / 1000));

      await provider.init();

      expect(await provider.getScores()).toEqual({ "example.com": 5 });
    });
  });

  describe("#_refreshScores", () => {
    beforeEach(() => {
      provider._rs = rsClient;
    });

    it("persists the scores and records the release time", async () => {
      getFlags.mockReturnValue({ [RECORD_ID]: true });
      rsClient.get.mockResolvedValue([{ ...VALID_RECORD, targets: {} }]);

      await provider._refreshScores();

      expect(cacheStore.scores).toEqual({});
      expect(prefStore[PREF_LAST_TIME]).toBe(Math.round(Date.now() / 1000));
    });

    it("skips recomputing when last release interval is 60 seconds ago", async () => {
      getFlags.mockReturnValue({ [RECORD_ID]: true });
      rsClient.get.mockResolvedValue([{ id: RECORD_ID }]);
      cacheStore.scores = { "example.com": 5 };
      jest
        .spyOn(provider, "_getLastReleaseTime")
        .mockReturnValue(Math.round(Date.now() / 1000) - 60);

      await provider._refreshScores();

      // Check that scores are untouched and release time is not set.
      expect(await provider.getScores()).toEqual({ "example.com": 5 });
      expect(prefStore[PREF_LAST_TIME]).toBeUndefined();
      expect(rsClient.get).not.toHaveBeenCalled();
    });
  });

  describe("#uninit", () => {
    it("clears the timer and client", async () => {
      getFlags.mockReturnValue({ [RECORD_ID]: true });
      await provider.init();

      provider.uninit();

      expect(provider._refreshTimer).toBeNull();
      expect(provider._rs).toBeNull();
    });
  });

  describe("#_getRecordId", () => {
    it("returns the enabled flag name when exactly one is enabled", () => {
      getFlags.mockReturnValue({ [RECORD_ID]: true });
      expect(provider._getRecordId()).toBe(RECORD_ID);
    });

    it("returns null when no flag is enabled", () => {
      expect(provider._getRecordId()).toBeNull();
    });

    it("returns null when multiple flags are enabled", () => {
      getFlags.mockReturnValue({
        sponsored_top_site_scoring: true,
        sponsored_top_site_scoring_1: true,
      });
      expect(provider._getRecordId()).toBeNull();
    });

    it("returns null when no flags exist", () => {
      getFlags.mockReturnValue(undefined);
      expect(provider._getRecordId()).toBeNull();
    });
  });

  describe("#_loadConfig", () => {
    beforeEach(() => {
      provider._rs = rsClient;
    });

    it("returns the record matching the enabled flag with hundredths converted", async () => {
      getFlags.mockReturnValue({ [RECORD_ID]: true });
      rsClient.get.mockResolvedValue([VALID_RECORD]);

      await expect(provider._loadConfig()).resolves.toEqual({
        ...VALID_RECORD,
        privacy_parameter: 0.5,
        repeat_visit_weight: 0.8,
        normalization_cap: 1.5,
      });
    });

    it("does not modify the Remote Settings record", async () => {
      getFlags.mockReturnValue({ [RECORD_ID]: true });
      const record = { ...VALID_RECORD };
      rsClient.get.mockResolvedValue([record]);

      await provider._loadConfig();

      expect(record).toEqual(VALID_RECORD);
    });

    it("caps the privacy parameter at 1", async () => {
      getFlags.mockReturnValue({ [RECORD_ID]: true });
      rsClient.get.mockResolvedValue([
        { ...VALID_RECORD, privacy_parameter: 500 },
      ]);

      const config = await provider._loadConfig();

      expect(config.privacy_parameter).toBe(1);
    });

    it("returns null when the matching record is invalid", async () => {
      getFlags.mockReturnValue({ [RECORD_ID]: true });
      rsClient.get.mockResolvedValue([{ ...VALID_RECORD, lookback_days: 0 }]);

      await expect(provider._loadConfig()).resolves.toBeNull();
    });

    it("returns null without calling Remote Settings when no flag is enabled", async () => {
      await expect(provider._loadConfig()).resolves.toBeNull();
      expect(rsClient.get).not.toHaveBeenCalled();
    });

    it("returns null when no record matches the enabled flag", async () => {
      getFlags.mockReturnValue({ [RECORD_ID]: true });
      rsClient.get.mockResolvedValue([{ id: "invalid_identifier" }]);

      await expect(provider._loadConfig()).resolves.toBeNull();
    });
  });

  describe("#_isValidConfig", () => {
    it("accepts a complete record", () => {
      expect(provider._isValidConfig(VALID_RECORD)).toBe(true);
    });

    it("accepts the boundary values", () => {
      expect(
        provider._isValidConfig({
          ...VALID_RECORD,
          lookback_days: 1,
          recency_halflife_days: 1,
          trend_days: 1,
          allowed_targets: 0,
          decimals: 4,
          privacy_parameter: 1,
          repeat_visit_weight: 0,
          normalization_cap: 1,
        })
      ).toBe(true);
    });

    it.each([
      ["lookback_days", 0],
      ["lookback_days", 1.5],
      ["recency_halflife_days", 0],
      ["trend_days", 0],
      ["allowed_targets", -1],
      ["decimals", 0],
      ["decimals", 5],
      ["privacy_parameter", 0],
      ["privacy_parameter", "50"],
      ["privacy_parameter", 0.5],
      ["repeat_visit_weight", -1],
      ["repeat_visit_weight", 100],
      ["normalization_cap", 0],
      ["normalization_cap", undefined],
    ])("rejects %s set to %p", (field, value) => {
      expect(provider._isValidConfig({ ...VALID_RECORD, [field]: value })).toBe(
        false
      );
    });
  });

  describe("#_getDomainDayCounts", () => {
    const config = {
      targets: { t1: ["example.com", "sub.example.org"] },
      lookback_days: 28,
    };

    const TODAY = 20000;
    beforeEach(() => {
      jest.setSystemTime(TODAY * 24 * 60 * 60 * 1000);
    });

    it("buckets visits per configured domain and day, merging subdomains and dropping other domains", async () => {
      executePlacesQuery.mockResolvedValue([
        { rev_host: "moc.elpmaxe.", day: TODAY, visits: 3 },
        { rev_host: "moc.elpmaxe.", day: TODAY - 1, visits: 1 },
        // www.example.com merges into example.com on the same day.
        { rev_host: "moc.elpmaxe.www.", day: TODAY - 1, visits: 2 },
        { rev_host: "gro.elpmaxe.bus.", day: TODAY - 1, visits: 2 },
        // Not a configured target, so it is dropped.
        { rev_host: "moc.rehto.", day: TODAY - 1, visits: 9 },
        // A null rev_host is dropped without error.
        { rev_host: null, day: TODAY - 1, visits: 1 },
      ]);

      const domainDayCounts = await provider._getDomainDayCounts(config);

      expect(domainDayCounts.get("example.com")).toEqual(
        new Map([
          [0, 3],
          [-1, 3],
        ])
      );
      expect(domainDayCounts.get("sub.example.org")).toEqual(
        new Map([[-1, 2]])
      );
      expect(domainDayCounts.size).toBe(2);
    });

    it("attributes a visit to the most specific configured domain", async () => {
      executePlacesQuery.mockResolvedValue([
        // sub.example.com is the more specific match and wins over example.com.
        { rev_host: "moc.elpmaxe.bus.", day: TODAY, visits: 2 },
        // Other subdomains fall back to the parent example.com.
        { rev_host: "moc.elpmaxe.www.", day: TODAY, visits: 1 },
      ]);

      const domainDayCounts = await provider._getDomainDayCounts({
        targets: { t1: ["example.com", "sub.example.com"] },
        lookback_days: 28,
      });

      expect(domainDayCounts.get("sub.example.com")).toEqual(new Map([[0, 2]]));
      expect(domainDayCounts.get("example.com")).toEqual(new Map([[0, 1]]));
    });

    it("returns an empty result without querying when there are no target domains", async () => {
      const domainDayCounts = await provider._getDomainDayCounts({
        targets: {},
        lookback_days: 28,
      });

      expect(domainDayCounts.size).toBe(0);
      expect(executePlacesQuery).not.toHaveBeenCalled();
    });
  });

  describe("#_domainScore", () => {
    const config = {
      recency_halflife_days: 1,
      repeat_visit_weight: 0.5,
      lookback_days: 2,
    };

    it("returns 0 when there are no visits", () => {
      expect(provider._domainScore(new Map(), config)).toBe(0);
    });

    it("repeat visits within a day", () => {
      expect(provider._domainScore(new Map([[0, 2]]), config)).toBe(0.5);
    });

    it("sums the contributions of each day", () => {
      expect(
        provider._domainScore(
          new Map([
            [0, 2],
            [-1, 1],
          ]),
          config
        )
      ).toBe(2 / 3);
    });

    it("ignores repeat visits when the weight is 0", () => {
      config.repeat_visit_weight = 0.0;
      expect(provider._domainScore(new Map([[-1, 2]]), config)).toBe(1 / 3);
    });
  });

  describe("#_sponsoredScores", () => {
    // A single visit today scores 1 / 3 per domain with this config.
    const config = {
      targets: {
        t1: ["example.com", "Example.org"],
        t2: ["example.net"],
      },
      recency_halflife_days: 1,
      repeat_visit_weight: 0.5,
      lookback_days: 2,
      normalization_cap: 2,
    };
    const domainDayCounts = new Map([
      ["example.com", new Map([[0, 1]])],
      ["example.org", new Map([[-1, 1]])],
    ]);

    it("sums domain scores per target and scores targets without visits as 0", () => {
      const scores = provider._sponsoredScores(config, domainDayCounts);

      expect(scores.t1).toBe(0.25);
      expect(scores.t2).toBe(0);
    });

    it("caps the score at 1 when the sum exceeds the normalization cap", () => {
      const scores = provider._sponsoredScores(
        { ...config, normalization_cap: 0.4 },
        domainDayCounts
      );

      expect(scores.t1).toBe(1);
      expect(scores.t2).toBe(0);
    });

    it("returns no scores when there are no targets", () => {
      expect(
        provider._sponsoredScores({ ...config, targets: {} }, domainDayCounts)
      ).toEqual({});
    });
  });

  describe("#_getOverlap", () => {
    it("returns the largest number of targets sharing one domain", () => {
      expect(
        provider._getOverlap({
          targets: {
            t1: ["example.com", "example.org"],
            t2: ["Example.com", "example.net"],
            t3: ["example.com", "example.org"],
          },
        })
      ).toBe(3);
    });

    it("returns 1 when no domain is shared between targets", () => {
      expect(
        provider._getOverlap({
          targets: {
            t1: ["example.com"],
            t2: ["example.org"],
          },
        })
      ).toBe(1);
    });

    it("returns 0 when there are no targets", () => {
      expect(provider._getOverlap({ targets: {} })).toBe(0);
    });
  });

  describe("#_differentiallyPrivateScores", () => {
    // Overlap is 4, so the scale is sqrt(4) / (0.5 * 10 * 0.5) = 0.8.
    const config = {
      targets: {
        t1: ["example.com"],
        t2: ["example.com"],
        t3: ["example.com"],
        t4: ["example.com", "example.org"],
      },
      normalization_cap: 0.5,
      lookback_days: 10,
      privacy_parameter: 0.5,
    };

    it("adds Laplace noise with the configured scale to each score", () => {
      const sampleLaplace = jest
        .spyOn(provider, "_sampleLaplace")
        .mockReturnValueOnce(0.3)
        .mockReturnValueOnce(-0.4);

      const scores = provider._differentiallyPrivateScores(
        { t1: 0.5, t2: 0.25 },
        config
      );

      expect(sampleLaplace).toHaveBeenCalledTimes(2);
      expect(sampleLaplace).toHaveBeenCalledWith(0.8);
      expect(scores.t1).toBeCloseTo(0.8);
      expect(scores.t2).toBeCloseTo(-0.15);
    });

    it("returns no scores when there are no scores", () => {
      expect(provider._differentiallyPrivateScores({}, config)).toEqual({});
    });
  });

  describe("#_sampleLaplace", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    function mockRandomValue(value) {
      jest.spyOn(crypto, "getRandomValues").mockImplementation(array => {
        array[0] = value;
        return array;
      });
    }

    it("returns a negative sample below the median", () => {
      mockRandomValue(2 ** 30);
      expect(provider._sampleLaplace(2)).toBeCloseTo(-2 * Math.LN2);
    });

    it("returns a positive sample above the median", () => {
      mockRandomValue(3 * 2 ** 30);
      expect(provider._sampleLaplace(2)).toBeCloseTo(2 * Math.LN2);
    });

    it("returns finite samples at the extremes of the random range", () => {
      mockRandomValue(0);
      expect(Number.isFinite(provider._sampleLaplace(1))).toBe(true);
      mockRandomValue(2 ** 32 - 1);
      expect(Number.isFinite(provider._sampleLaplace(1))).toBe(true);
    });

    it("has a mean absolute value equal to the scale", () => {
      const samples = 10000;
      let sum = 0;
      for (let i = 0; i < samples; i++) {
        sum += Math.abs(provider._sampleLaplace(1));
      }
      expect(sum / samples).toBeCloseTo(1, 1);
    });
  });
});
