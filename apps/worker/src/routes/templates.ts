import { Hono } from 'hono';
import type { Env } from '../types';
import { newId, now, jsonStringify } from '../db/helpers';
import type { ProxyRule } from '@uni-conf/types';

const app = new Hono<{ Bindings: Env }>();

// ─── Built-in templates ───────────────────────────────────────────────────────

type TemplateRule = Omit<ProxyRule, 'id' | 'targetGroupId' | 'createdAt' | 'updatedAt'>;

interface BuiltinTemplate {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  category: string;
  suggestedGroupName?: string;
  rules: TemplateRule[];
  remoteSets?: Array<{
    name: string;
    url: string;
    format: 'clash' | 'mihomo' | 'singbox' | 'surge' | 'text';
    updateInterval: number;
    enabled: boolean;
    notes?: string;
  }>;
  isBuiltin: true;
  createdAt: string;
}

const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'ai',
    name: 'AI 服务',
    nameEn: 'AI Services',
    description: '包含 OpenAI、Anthropic、Google Gemini、Claude 等 AI 服务的分流规则',
    descriptionEn: 'Rules for OpenAI, Anthropic, Google Gemini, Claude and other AI services',
    category: 'productivity',
    suggestedGroupName: 'AI',
    isBuiltin: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    rules: [
      {
        name: 'OpenAI',
        type: 'DOMAIN-SUFFIX',
        payload: 'openai.com',
        enabled: true,
        order: 0,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'OpenAI API',
        type: 'DOMAIN-SUFFIX',
        payload: 'oaistatic.com',
        enabled: true,
        order: 1,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'OpenAI CDN',
        type: 'DOMAIN-SUFFIX',
        payload: 'oaiusercontent.com',
        enabled: true,
        order: 2,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'ChatGPT',
        type: 'DOMAIN-SUFFIX',
        payload: 'chatgpt.com',
        enabled: true,
        order: 3,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Anthropic',
        type: 'DOMAIN-SUFFIX',
        payload: 'anthropic.com',
        enabled: true,
        order: 4,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Claude',
        type: 'DOMAIN-SUFFIX',
        payload: 'claude.ai',
        enabled: true,
        order: 5,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Google Gemini',
        type: 'DOMAIN-SUFFIX',
        payload: 'gemini.google.com',
        enabled: true,
        order: 6,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Google AI Studio',
        type: 'DOMAIN-SUFFIX',
        payload: 'aistudio.google.com',
        enabled: true,
        order: 7,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Perplexity',
        type: 'DOMAIN-SUFFIX',
        payload: 'perplexity.ai',
        enabled: true,
        order: 8,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Midjourney',
        type: 'DOMAIN-SUFFIX',
        payload: 'midjourney.com',
        enabled: true,
        order: 9,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Hugging Face',
        type: 'DOMAIN-SUFFIX',
        payload: 'huggingface.co',
        enabled: true,
        order: 10,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Cohere',
        type: 'DOMAIN-SUFFIX',
        payload: 'cohere.ai',
        enabled: true,
        order: 11,
        noResolve: false,
        compatibility: [],
      },
    ],
  },
  {
    id: 'streaming',
    name: '流媒体服务',
    nameEn: 'Streaming Services',
    description: '包含 Netflix、YouTube、Disney+、Spotify 等流媒体服务的分流规则',
    descriptionEn: 'Rules for Netflix, YouTube, Disney+, Spotify and other streaming services',
    category: 'media',
    suggestedGroupName: 'Streaming',
    isBuiltin: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    rules: [
      {
        name: 'Netflix',
        type: 'DOMAIN-SUFFIX',
        payload: 'netflix.com',
        enabled: true,
        order: 0,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Netflix Assets',
        type: 'DOMAIN-SUFFIX',
        payload: 'nflximg.net',
        enabled: true,
        order: 1,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Netflix CDN',
        type: 'DOMAIN-SUFFIX',
        payload: 'nflxvideo.net',
        enabled: true,
        order: 2,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'YouTube',
        type: 'DOMAIN-SUFFIX',
        payload: 'youtube.com',
        enabled: true,
        order: 3,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'YouTube CDN',
        type: 'DOMAIN-SUFFIX',
        payload: 'googlevideo.com',
        enabled: true,
        order: 4,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'YouTubeimg',
        type: 'DOMAIN-SUFFIX',
        payload: 'ytimg.com',
        enabled: true,
        order: 5,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Disney+',
        type: 'DOMAIN-SUFFIX',
        payload: 'disneyplus.com',
        enabled: true,
        order: 6,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Disney CDN',
        type: 'DOMAIN-SUFFIX',
        payload: 'bamgrid.com',
        enabled: true,
        order: 7,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Spotify',
        type: 'DOMAIN-SUFFIX',
        payload: 'spotify.com',
        enabled: true,
        order: 8,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Spotify CDN',
        type: 'DOMAIN-SUFFIX',
        payload: 'scdn.co',
        enabled: true,
        order: 9,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'HBO Max',
        type: 'DOMAIN-SUFFIX',
        payload: 'max.com',
        enabled: true,
        order: 10,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Hulu',
        type: 'DOMAIN-SUFFIX',
        payload: 'hulu.com',
        enabled: true,
        order: 11,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Twitch',
        type: 'DOMAIN-SUFFIX',
        payload: 'twitch.tv',
        enabled: true,
        order: 12,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Apple TV+',
        type: 'DOMAIN-SUFFIX',
        payload: 'tv.apple.com',
        enabled: true,
        order: 13,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Amazon Prime Video',
        type: 'DOMAIN-SUFFIX',
        payload: 'primevideo.com',
        enabled: true,
        order: 14,
        noResolve: false,
        compatibility: [],
      },
    ],
  },
  {
    id: 'social',
    name: '社交媒体',
    nameEn: 'Social Media',
    description: '包含 Twitter/X、Instagram、Facebook、TikTok、Telegram 等社交媒体的分流规则',
    descriptionEn: 'Rules for Twitter/X, Instagram, Facebook, TikTok, Telegram and other social media',
    category: 'social',
    suggestedGroupName: 'Social',
    isBuiltin: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    rules: [
      {
        name: 'Twitter/X',
        type: 'DOMAIN-SUFFIX',
        payload: 'twitter.com',
        enabled: true,
        order: 0,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'X.com',
        type: 'DOMAIN-SUFFIX',
        payload: 'x.com',
        enabled: true,
        order: 1,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Twitter CDN',
        type: 'DOMAIN-SUFFIX',
        payload: 'twimg.com',
        enabled: true,
        order: 2,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Instagram',
        type: 'DOMAIN-SUFFIX',
        payload: 'instagram.com',
        enabled: true,
        order: 3,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Facebook',
        type: 'DOMAIN-SUFFIX',
        payload: 'facebook.com',
        enabled: true,
        order: 4,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Facebook CDN',
        type: 'DOMAIN-SUFFIX',
        payload: 'fbcdn.net',
        enabled: true,
        order: 5,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'WhatsApp',
        type: 'DOMAIN-SUFFIX',
        payload: 'whatsapp.com',
        enabled: true,
        order: 6,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'TikTok',
        type: 'DOMAIN-SUFFIX',
        payload: 'tiktok.com',
        enabled: true,
        order: 7,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'TikTok CDN',
        type: 'DOMAIN-SUFFIX',
        payload: 'tiktokcdn.com',
        enabled: true,
        order: 8,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Telegram',
        type: 'DOMAIN-SUFFIX',
        payload: 'telegram.org',
        enabled: true,
        order: 9,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Telegram API',
        type: 'DOMAIN-SUFFIX',
        payload: 't.me',
        enabled: true,
        order: 10,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Telegram IP',
        type: 'IP-CIDR',
        payload: '149.154.160.0/20',
        enabled: true,
        order: 11,
        noResolve: true,
        compatibility: [],
      },
      {
        name: 'Telegram IP6',
        type: 'IP-CIDR',
        payload: '91.108.4.0/22',
        enabled: true,
        order: 12,
        noResolve: true,
        compatibility: [],
      },
      {
        name: 'Reddit',
        type: 'DOMAIN-SUFFIX',
        payload: 'reddit.com',
        enabled: true,
        order: 13,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Discord',
        type: 'DOMAIN-SUFFIX',
        payload: 'discord.com',
        enabled: true,
        order: 14,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Discord CDN',
        type: 'DOMAIN-SUFFIX',
        payload: 'discordapp.com',
        enabled: true,
        order: 15,
        noResolve: false,
        compatibility: [],
      },
    ],
  },
  {
    id: 'china-direct',
    name: '中国直连',
    nameEn: 'China Direct',
    description: '中国大陆域名和 IP 直连规则，包含 GEOSITE:CN 和 GEOIP:CN',
    descriptionEn: 'Direct connection rules for mainland China domains and IPs using GEOSITE:CN and GEOIP:CN',
    category: 'routing',
    suggestedGroupName: 'DIRECT',
    isBuiltin: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    rules: [
      {
        name: 'China Sites',
        type: 'GEOSITE',
        payload: 'CN',
        enabled: true,
        order: 0,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'China IP',
        type: 'GEOIP',
        payload: 'CN',
        enabled: true,
        order: 1,
        noResolve: true,
        compatibility: [],
      },
      {
        name: 'Private IP',
        type: 'IP-CIDR',
        payload: '192.168.0.0/16',
        enabled: true,
        order: 2,
        noResolve: true,
        compatibility: [],
      },
      {
        name: 'Private IP 10',
        type: 'IP-CIDR',
        payload: '10.0.0.0/8',
        enabled: true,
        order: 3,
        noResolve: true,
        compatibility: [],
      },
      {
        name: 'Private IP 172',
        type: 'IP-CIDR',
        payload: '172.16.0.0/12',
        enabled: true,
        order: 4,
        noResolve: true,
        compatibility: [],
      },
      {
        name: 'Localhost',
        type: 'IP-CIDR',
        payload: '127.0.0.0/8',
        enabled: true,
        order: 5,
        noResolve: true,
        compatibility: [],
      },
    ],
  },
  {
    id: 'reject',
    name: '广告拦截',
    nameEn: 'Ad Blocking',
    description: '常见广告和追踪域名拦截规则，使用 RULE-SET 指向知名广告拦截列表',
    descriptionEn: 'Common ad and tracking domain blocking rules using RULE-SET pointing to well-known ad blocklists',
    category: 'privacy',
    suggestedGroupName: 'REJECT',
    isBuiltin: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    rules: [
      {
        name: 'Ad Domains',
        type: 'RULE-SET',
        payload: 'reject',
        enabled: true,
        order: 0,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Google Ads',
        type: 'DOMAIN-SUFFIX',
        payload: 'googlesyndication.com',
        enabled: true,
        order: 1,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'DoubleClick',
        type: 'DOMAIN-SUFFIX',
        payload: 'doubleclick.net',
        enabled: true,
        order: 2,
        noResolve: false,
        compatibility: [],
      },
      {
        name: 'Facebook Ads',
        type: 'DOMAIN-SUFFIX',
        payload: 'an.facebook.com',
        enabled: true,
        order: 3,
        noResolve: false,
        compatibility: [],
      },
    ],
    remoteSets: [
      {
        name: 'Reject List',
        url: 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt',
        format: 'text',
        updateInterval: 24,
        enabled: true,
        notes: 'Loyalsoldier reject list',
      },
    ],
  },
];

// ─── List templates ───────────────────────────────────────────────────────────

app.get('/', (c) => {
  const summaries = BUILTIN_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    nameEn: t.nameEn,
    description: t.description,
    descriptionEn: t.descriptionEn,
    category: t.category,
    suggestedGroupName: t.suggestedGroupName,
    ruleCount: t.rules.length,
    hasRemoteSets: (t.remoteSets?.length ?? 0) > 0,
    isBuiltin: t.isBuiltin,
    createdAt: t.createdAt,
  }));
  return c.json({ success: true, data: summaries });
});

// ─── Get template detail ──────────────────────────────────────────────────────

app.get('/:id', (c) => {
  const id = c.req.param('id');
  const template = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (!template) {
    return c.json({ success: false, error: 'Template not found' }, 404);
  }
  return c.json({ success: true, data: template });
});

// ─── Import template rules ────────────────────────────────────────────────────

app.post('/:id/import', async (c) => {
  const templateId = c.req.param('id');
  const template = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return c.json({ success: false, error: 'Template not found' }, 404);
  }

  const body = await c.req.json<{ targetGroupId: string }>();
  if (!body.targetGroupId) {
    return c.json({ success: false, error: 'targetGroupId is required' }, 400);
  }

  // Verify group exists
  const group = await c.env.DB.prepare('SELECT id FROM groups WHERE id = ?')
    .bind(body.targetGroupId)
    .first();
  if (!group) {
    return c.json({ success: false, error: 'Target group not found' }, 404);
  }

  const ts = now();

  // Get current max sort_order
  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM rules'
  ).first<{ max_order: number | null }>();
  let nextOrder = (maxRow?.max_order ?? -1) + 1;

  const createdRules: ProxyRule[] = [];

  for (const rule of template.rules) {
    const id = newId();
    await c.env.DB.prepare(
      `INSERT INTO rules (id, name, type, payload, no_resolve, target_group_id, enabled, sort_order, notes, compatibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        rule.name ?? null,
        rule.type,
        rule.payload,
        rule.noResolve ? 1 : 0,
        body.targetGroupId,
        rule.enabled !== false ? 1 : 0,
        nextOrder,
        rule.notes ?? null,
        jsonStringify(rule.compatibility ?? []),
        ts,
        ts
      )
      .run();

    createdRules.push({
      id,
      name: rule.name,
      type: rule.type,
      payload: rule.payload,
      noResolve: rule.noResolve,
      targetGroupId: body.targetGroupId,
      enabled: rule.enabled !== false,
      order: nextOrder,
      notes: rule.notes,
      compatibility: rule.compatibility ?? [],
      createdAt: ts,
      updatedAt: ts,
    });

    nextOrder++;
  }

  // Import remote rule sets if any
  const createdRemoteSets = [];
  if (template.remoteSets) {
    for (const rset of template.remoteSets) {
      const id = newId();
      await c.env.DB.prepare(
        `INSERT INTO remote_rule_sets (id, name, url, format, target_group_id, update_interval, enabled, last_updated, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      )
        .bind(
          id,
          rset.name,
          rset.url,
          rset.format,
          body.targetGroupId,
          rset.updateInterval,
          rset.enabled ? 1 : 0,
          rset.notes ?? null,
          ts,
          ts
        )
        .run();

      createdRemoteSets.push({
        id,
        name: rset.name,
        url: rset.url,
        format: rset.format,
        targetGroupId: body.targetGroupId,
        updateInterval: rset.updateInterval,
        enabled: rset.enabled,
        notes: rset.notes,
        createdAt: ts,
        updatedAt: ts,
      });
    }
  }

  return c.json({
    success: true,
    data: {
      templateId,
      targetGroupId: body.targetGroupId,
      rules: createdRules,
      remoteSets: createdRemoteSets,
    },
  }, 201);
});

export default app;
