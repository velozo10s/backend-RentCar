const refreshTokensByUser = new Map();
const blacklistedAccessTokens = new Set();

const tokenStore = {
    // Refresh token (por usuario)
    setRefresh: (userId, token) => refreshTokensByUser.set(userId, token),
    getRefresh: (userId) => refreshTokensByUser.get(userId),
    hasRefresh: (token) => [...refreshTokensByUser.values()].includes(token),
    removeRefresh: (userId) => refreshTokensByUser.delete(userId),

    // Access token blacklist
    blacklistAccess: (token) => blacklistedAccessTokens.add(token),
    isBlacklistedAccess: (token) => blacklistedAccessTokens.has(token),

    // Utilities
    clearAll: () => {
        refreshTokensByUser.clear();
        blacklistedAccessTokens.clear();
    }
};

export default tokenStore;

