const { RtcTokenBuilder, RtcRole } = require("agora-access-token");

/**
 * Generate Agora RTC Token
 * @param {string} channelName - Live stream ID
 * @param {string|number} uid - User ID (0 allowed)
 * @param {number} expireSeconds - Token validity in seconds
 * @param {boolean} isPublisher - true for host, false for audience
 */
function generateAgoraToken(channelName, uid, expireSeconds = 3600, isPublisher = false) {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERT;

    if (!appId || !appCertificate) {
        throw new Error("Agora App ID or Certificate not set in environment variables");
    }

    const role = isPublisher ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpireTime = currentTimestamp + expireSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        channelName,
        uid,
        role,
        privilegeExpireTime
    );

    return token;
}

module.exports = {
    generateAgoraToken
};