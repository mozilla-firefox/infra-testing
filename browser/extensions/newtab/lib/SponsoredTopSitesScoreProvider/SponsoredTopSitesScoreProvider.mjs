/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { XPCOMUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
);

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  PersistentCache: "resource://newtab/lib/PersistentCache.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  NewTabUtils: "resource://gre/modules/NewTabUtils.sys.mjs",
  RemoteSettings: "resource://services-settings/remote-settings.sys.mjs",
  clearInterval: "resource://gre/modules/Timer.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
});

// Microseconds per day to match on visit_date
const US_PER_DAY = 24 * 60 * 60 * 1000 * 1000;

// How often scores are recomputed in milliseconds (24 hours).
const RELEASE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REMOTE_SETTINGS_COLLECTION = "newtab-sponsored-topsites-scoring";

// The prefix for flags to check when attempting to load the remote settings record.
const FLAG_PREFIX = "sponsored_top_site_scoring";

// Upper bound on config.privacy_parameter to limit the total privacy loss
const MAX_PRIVACY_PARAMETER = 1;
const CACHE_KEY = "sponsored_topsites_scoring_cache";
const SCORES_CACHE_KEY = "scores";

const PREF_LAST_RELEASE_TIME =
  "browser.newtabpage.activity-stream.sponsoredTopSitesScoring.lastReleaseTime";

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "LAST_RELEASE_TIME_PREF_VALUE",
  PREF_LAST_RELEASE_TIME,
  0
);

export class SponsoredTopSitesScoreProvider {
  /**
   * @param {Function} getFlags Returns the current adsBackend flags for selecting
   *  a configuration record through remote settings.
   */
  constructor(getFlags) {
    this._getFlags = getFlags;
    this._refreshTimer = null;
    this._rs = null;
    this._cache = new lazy.PersistentCache(CACHE_KEY, false);
  }

  /**
   * Starts the scoring. This creates the Remote Settings client, schedules a
   * periodic refresh, and loads the first set of scores.
   *
   * @returns {Promise<void>} Resolves once the initial refresh completes.
   */
  async init() {
    if (!this._rs) {
      this._rs = lazy.RemoteSettings(REMOTE_SETTINGS_COLLECTION);
    }
    if (!this._refreshTimer) {
      this._refreshTimer = lazy.setInterval(
        () => this._refreshScores(),
        RELEASE_INTERVAL_MS
      );
    }
    await this._refreshScores();
  }

  /**
   * Stops the scoring. This cancels the refresh timer and clears any calculated
   * scores. Invoke this when scoring is disabled or the consumer is uninitializing.
   */
  uninit() {
    if (this._refreshTimer) {
      lazy.clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    this._rs = null;
  }

  /**
   * Load any active config and update the cached scores. Resets the scores when
   * no config exists.
   *
   * @returns {Promise<void>} Resolves once the cached scores are updated.
   */
  async _refreshScores() {
    // Return early if a full release interval has not elapsed.
    const now = Math.round(Date.now() / 1000);
    if (now - this._getLastReleaseTime() < RELEASE_INTERVAL_MS / 1000) {
      return;
    }

    const config = await this._loadConfig();
    if (!config) {
      await this._setScores({});
      return;
    }

    const domainDayCounts = await this._getDomainDayCounts(config);
    const scores = this._sponsoredScores(config, domainDayCounts);
    // TODO: post-process the private scores before they are sent to the server.
    const scoresWithDP = this._differentiallyPrivateScores(scores, config);
    await this._setScores(scoresWithDP);
    Services.prefs.setIntPref(PREF_LAST_RELEASE_TIME, now);
  }

  /**
   * The timestamp of the last release in seconds.
   *
   * @returns {number} The last release time in seconds.
   */
  _getLastReleaseTime() {
    return lazy.LAST_RELEASE_TIME_PREF_VALUE;
  }

  /**
   * Load the Remote Settings record with the matching id of the enabled flag.
   * The privacy_parameter, repeat_visit_weight, and normalization_cap fields
   * are stored as integer hundredths and are converted to their decimal
   * values, with privacy_parameter capped at MAX_PRIVACY_PARAMETER.
   *
   * @returns {Promise<?object>} The matching config or null when not found or
   *  invalid.
   */
  async _loadConfig() {
    const recordId = this._getRecordId();
    if (!recordId) {
      return null;
    }

    const records = await this._rs?.get();
    const record = records?.find(r => r.id === recordId);
    if (!record || !this._isValidConfig(record)) {
      return null;
    }

    return {
      ...record,
      privacy_parameter: Math.min(
        record.privacy_parameter / 100,
        MAX_PRIVACY_PARAMETER
      ),
      repeat_visit_weight: record.repeat_visit_weight / 100,
      normalization_cap: record.normalization_cap / 100,
    };
  }

  /**
   * Check that the numeric fields of a Remote Settings record are integers
   * within a range that produces meaningful scores.
   *
   * @param {object} record The raw Remote Settings record.
   * @returns {boolean} Whether the record can be used for scoring.
   */
  _isValidConfig(record) {
    const isIntegerInRange = (value, min, max = Infinity) =>
      Number.isInteger(value) && value >= min && value <= max;

    return (
      isIntegerInRange(record.lookback_days, 1) &&
      isIntegerInRange(record.recency_halflife_days, 1) &&
      isIntegerInRange(record.trend_days, 1) &&
      isIntegerInRange(record.allowed_targets, 0) &&
      isIntegerInRange(record.decimals, 1, 4) &&
      isIntegerInRange(record.privacy_parameter, 1) &&
      isIntegerInRange(record.normalization_cap, 1) &&
      isIntegerInRange(record.repeat_visit_weight, 0, 99)
    );
  }

  /**
   * Gets the Remote Settings record id to load by checking for an
   * enabled flag with the matching prefix. At most one flag should be
   * enabled. Returns null if multiple matching flags are enabled.
   *
   * @returns {?string} The record id to load. null when no flag is
   * enabled or more than one enabled flag is found.
   */
  _getRecordId() {
    const flags = this._getFlags?.() ?? {};
    const enabled = Object.keys(flags).filter(
      flag => flag.startsWith(FLAG_PREFIX) && flags[flag]
    );
    return enabled.length === 1 ? enabled[0] : null;
  }

  /**
   * Persist the scores.
   *
   * @param {object} scores The scores to store.
   * @returns {Promise<void>} Resolves once the scores are persisted.
   */
  async _setScores(scores) {
    await this._cache.set(SCORES_CACHE_KEY, scores);
  }

  /**
   * Get the currently calculated scores from the cache.
   *
   * @returns {Promise<object>} A map of scores.
   */
  async getScores() {
    return (await this._cache.get(SCORES_CACHE_KEY)) ?? {};
  }

  /**
   * Sum visits to the configured target domains by domain and day.
   *
   * @param {object} config The active Remote Settings config.
   * @returns {Promise<Map<string, Map<number, number>>>} The visit count per
   *  configured domain, keyed by day, in the lookback window.
   */
  async _getDomainDayCounts(config) {
    const prefixMap = this._revHostPrefixMap(config);
    if (!prefixMap.size) {
      return new Map();
    }

    const todayDay = Math.floor((Date.now() * 1000) / US_PER_DAY);
    const sinceDay = todayDay - (config.lookback_days - 1);
    const query = `
      SELECT
        p.rev_host AS rev_host,
        CAST(v.visit_date / ${US_PER_DAY} AS INTEGER) AS day,
        COUNT(*) AS visits
      FROM moz_historyvisits v
      JOIN moz_places p ON p.id = v.place_id
      WHERE v.visit_date >= :since_date
        AND v.visit_type IN
        (${lazy.PlacesUtils.history.TRANSITIONS.LINK},
         ${lazy.PlacesUtils.history.TRANSITIONS.TYPED},
         ${lazy.PlacesUtils.history.TRANSITIONS.BOOKMARK})
      GROUP BY p.rev_host, day
    `;

    const rows =
      await lazy.NewTabUtils.activityStreamProvider.executePlacesQuery(query, {
        columns: ["rev_host", "day", "visits"],
        params: { since_date: sinceDay * US_PER_DAY },
      });

    // Filter domains and sum by day.
    const domainDayCounts = new Map();
    for (const row of rows) {
      const domain = this._findConfiguredDomain(row.rev_host, prefixMap);
      if (!domain) {
        continue;
      }

      const days = domainDayCounts.get(domain) ?? new Map();
      const dayOffset = row.day - todayDay;
      days.set(dayOffset, (days.get(dayOffset) ?? 0) + row.visits);
      domainDayCounts.set(domain, days);
    }

    return domainDayCounts;
  }

  /**
   * Score a domain from its daily visit counts. More recent visits are
   * weighted more heavily, and more visits in a day give a higher overall score
   * depending upon the repeat_visit_weight. The score is normalized to [0, 1].
   *
   * @param {Map<number, number>} dayCounts Visit count keyed by day offset
   *  relative to today (0 is today, -1 is yesterday, ...).
   * @param {object} config The active Remote Settings config.
   * @returns {number} The domain score.
   */
  _domainScore(dayCounts, config) {
    const decay = Math.LN2 / config.recency_halflife_days;

    let score = 0;
    for (const [day, visits] of dayCounts) {
      score +=
        Math.exp(day * decay) * (1 - config.repeat_visit_weight ** visits);
    }

    let normalization = 0;
    for (let j = 0; j < config.lookback_days; j++) {
      normalization += Math.exp(-j * decay);
    }

    return score / normalization;
  }

  /**
   * Score each sponsored target. Take the sum of scores of each domain and
   * divide by config.normalization_cap to account for different sized
   * list of domains between targets.
   *
   * @param {object} config The active Remote Settings config.
   * @param {Map<string, Map<number, number>>} domainDayCounts The visit count
   *  per configured domain, keyed by day offset, from _getDomainDayCounts.
   * @returns {object} A score in [0, 1] keyed by target.
   */
  _sponsoredScores(config, domainDayCounts) {
    const scores = {};
    for (const [target, domains] of Object.entries(config.targets ?? {})) {
      let sum = 0;
      for (const domain of domains ?? []) {
        const dayCounts = domainDayCounts.get(domain.toLowerCase());
        if (dayCounts) {
          sum += this._domainScore(dayCounts, config);
        }
      }
      scores[target] =
        Math.min(sum, config.normalization_cap) / config.normalization_cap;
    }
    return scores;
  }

  /**
   * Count the maximum number of sponsored targets associated to any single domain.
   *
   * @param {object} config The active Remote Settings config.
   * @returns {number} The largest number of targets sharing one domain
   */
  _getOverlap(config) {
    const targetCounts = new Map();
    for (const domains of Object.values(config.targets ?? {})) {
      for (const domain of new Set(domains?.map(d => d.toLowerCase()))) {
        targetCounts.set(domain, (targetCounts.get(domain) ?? 0) + 1);
      }
    }
    return Math.max(0, ...targetCounts.values());
  }

  /**
   * Add Laplace noise to each target score for differential privacy.
   * The total privacy composition over all scoring will be accounted for
   * with zCDP and applying some tight accounting tricks.
   * TODO: add a link to the zCDP accounting once it is published.
   *
   * These noised scores will not leave the client, and there will instead
   * be post-processing, clamping, and rounding to avoid floating point issues
   * with the privacy-preserving scores that are ultimately sent back to the server.
   *
   * @param {object} scores A score keyed by target, from _sponsoredScores.
   * @param {object} config The active Remote Settings config.
   * @returns {object} The noised score keyed by target.
   */
  _differentiallyPrivateScores(scores, config) {
    const scale =
      Math.sqrt(this._getOverlap(config)) /
      (config.normalization_cap *
        config.lookback_days *
        config.privacy_parameter);

    const privateScores = {};
    for (const [target, score] of Object.entries(scores)) {
      privateScores[target] = score + this._sampleLaplace(scale);
    }
    return privateScores;
  }

  /**
   * Draw a sample from a Laplace distribution centered at 0.
   *
   * @param {number} scale The scale (b) of the distribution.
   * @returns {number} The sample.
   */
  _sampleLaplace(scale) {
    const randomValues = new Uint32Array(1);
    crypto.getRandomValues(randomValues);
    const u = (randomValues[0] + 0.5) / 2 ** 32;
    return u < 0.5 ? scale * Math.log(2 * u) : -scale * Math.log(2 * (1 - u));
  }

  /**
   * Build a map of rev_host prefix to configured domain.
   *
   * @param {object} config The active Remote Settings config.
   * @returns {Map<string, string>} Reversed host prefix to domain, e.g.
   *  "moc.elpmaxe." to "example.com".
   */
  _revHostPrefixMap(config) {
    const prefixMap = new Map();
    for (const domains of Object.values(config.targets ?? {})) {
      for (const domain of domains ?? []) {
        const loweredDomain = domain.toLowerCase();
        prefixMap.set(
          lazy.PlacesUtils.getReversedHost(new URL(`http://${loweredDomain}`)),
          loweredDomain
        );
      }
    }
    return prefixMap;
  }

  /**
   * Lookup a rev_host against the configured domains by checking each label
   * boundary. The most specific configured domain wins if multiple match.
   *
   * @param {?string} revHost The rev_host from moz_places, which is nullable.
   * @param {Map<string, string>} prefixMap rev_host prefix to domain.
   * @returns {?string} The matched domain, or null when none matches.
   */
  _findConfiguredDomain(revHost, prefixMap) {
    // Trim the empty last element due to the trailing dot in rev_host
    const labels = revHost?.split(".").slice(0, -1) ?? [];
    let prefix = "";
    let match = null;
    for (const label of labels) {
      prefix += `${label}.`;
      match = prefixMap.get(prefix) ?? match;
    }
    return match;
  }
}
