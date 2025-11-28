// frontend/js/utils/cache.js
// Simple in-memory cache with TTL support for API responses

class CacheEntry {
  constructor(data, ttl) {
    this.data = data;
    this.timestamp = Date.now();
    this.ttl = ttl;
  }

  isExpired() {
    return Date.now() - this.timestamp > this.ttl;
  }
}

class ApiCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Get cached data by key
   * @param {string} key - Cache key
   * @returns {any|null} - Cached data or null if expired/missing
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (entry.isExpired()) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cache entry
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   * @param {number} ttl - Time to live in milliseconds (default: 60000 = 1 minute)
   */
  set(key, data, ttl = 60000) {
    this.cache.set(key, new CacheEntry(data, ttl));
  }

  /**
   * Clear specific cache entry
   * @param {string} key - Cache key to clear
   */
  clear(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clearAll() {
    this.cache.clear();
  }

  /**
   * Clear all expired entries
   */
  clearExpired() {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.isExpired()) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get or fetch data with caching
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Async function to fetch data if not cached
   * @param {number} ttl - Time to live in milliseconds
   * @returns {Promise<any>} - Cached or freshly fetched data
   */
  async getOrFetch(key, fetchFn, ttl = 60000) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const data = await fetchFn();
    this.set(key, data, ttl);
    return data;
  }
}

// Export singleton instance
export const apiCache = new ApiCache();

// Periodically clear expired entries (every 5 minutes)
setInterval(() => {
  apiCache.clearExpired();
}, 5 * 60 * 1000);

// Clear all cache when user logs out (listen for custom event)
window.addEventListener('user-logout', () => {
  apiCache.clearAll();
});
