const { EmbedBuilder } = require('discord.js');

const PROMOTION_LINKS = Object.freeze({
  youtube: 'https://www.youtube.com/@ideologiakal?sub_confirmation=1',
  discord: 'https://discord.gg/XzTwxsSNRV',
});
const PROMOTION_EMOJI = Object.freeze({
  id: '1559015048960282664',
  name: 'promo',
  animated: true,
});
const PROMOTION_FOOTER = 'Subscribe YouTube Ideologi Akal • Join Discord Dàxia Community';

function addPromotionFooter(embed) {
  const embedData = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
  if (!embedData || typeof embedData !== 'object') return embed;
  const footer = embedData.footer || {};
  if (String(footer.text || '').includes('Join Discord Dàxia Community')) return embed;

  const separator = footer.text ? ' • ' : '';
  const availableLength = Math.max(0, 2048 - separator.length - PROMOTION_FOOTER.length);
  const existingText = String(footer.text || '').slice(0, availableLength);
  const nextEmbed = {
    ...embedData,
    footer: {
      ...footer,
      text: `${existingText}${separator}${PROMOTION_FOOTER}`,
    },
  };
  return embed instanceof EmbedBuilder ? EmbedBuilder.from(nextEmbed) : nextEmbed;
}

function componentUrl(component) {
  return component?.url || component?.data?.url || '';
}

function createPromotionRow(links) {
  return {
    type: 1,
    components: links.map(({ label, url }) => ({
      type: 2,
      style: 5,
      label,
      url,
      emoji: { ...PROMOTION_EMOJI },
    })),
  };
}

function addPromotionLinks(payload) {
  const nextPayload = typeof payload === 'string'
    ? { content: payload }
    : payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload }
      : payload;
  if (!nextPayload || typeof nextPayload !== 'object') return nextPayload;

  if (Array.isArray(nextPayload.embeds)) {
    nextPayload.embeds = nextPayload.embeds.map(addPromotionFooter);
  }

  const components = Array.isArray(nextPayload.components) ? [...nextPayload.components] : [];
  const existingUrls = new Set(
    components.flatMap((row) => (row.components || []).map(componentUrl).filter(Boolean)),
  );
  const links = [
    { label: 'YouTube', url: PROMOTION_LINKS.youtube },
    { label: 'Discord', url: PROMOTION_LINKS.discord },
  ].filter(({ url }) => !existingUrls.has(url));

  if (!links.length) return nextPayload;

  if (components.length < 5) {
    components.push(createPromotionRow(links));
    nextPayload.components = components;
    return nextPayload;
  }

  const linksText = `YouTube: ${PROMOTION_LINKS.youtube}\nDiscord: ${PROMOTION_LINKS.discord}`;
  const content = typeof nextPayload.content === 'string' ? nextPayload.content : '';
  nextPayload.content = `${content.slice(0, Math.max(0, 2000 - linksText.length - 1))}\n${linksText}`.trim();
  return nextPayload;
}

function addPromotionToInteraction(interaction) {
  for (const method of ['reply', 'editReply', 'followUp']) {
    const original = interaction[method];
    if (typeof original !== 'function') continue;
    interaction[method] = function addPromotionToResponse(payload, ...args) {
      return original.call(this, addPromotionLinks(payload), ...args);
    };
  }
}

module.exports = {
  PROMOTION_LINKS,
  PROMOTION_EMOJI,
  PROMOTION_FOOTER,
  addPromotionFooter,
  addPromotionLinks,
  addPromotionToInteraction,
};
