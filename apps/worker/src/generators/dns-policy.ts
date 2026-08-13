import type { ExportDnsPolicy } from '@uni-conf/types';
import { normalizeDnsRealIpDomain, normalizeDnsRealIpDomainList } from '@uni-conf/shared';

export const QUIXOTIC_FAKE_IP_FILTER_MRS_URL =
  'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/meta/domain/fake-ip-filter.mrs';
export const QUIXOTIC_FAKE_IP_FILTER_SRS_URL =
  'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/singbox/version5/fake-ip-filter.srs';
export const QUIXOTIC_FAKE_IP_FILTER_TEXT_URL =
  'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/meta/domain/fake-ip-filter.list';
export const MANAGED_FAKE_IP_FILTER_TAG = 'uni-conf-fake-ip-filter';

// Bundled fallback for clients that require an inline list and for exports made
// while GitHub or KV is unavailable. Refreshed from Quixotic's ruleset branch.
const QUIXOTIC_FAKE_IP_FILTER_SNAPSHOT = `
*
+.10099.com.cn
+.126.net
+.3gppnetwork.org
+.battle.net
+.battlenet.com.cn
+.blzstatic.cn
+.bogon
+.cdn.nintendo.net
+.cmbchina.com
+.cmbimg.com
+.cmpassport.com
+.direct
+.dynv6.net
+.example
+.ff14.sdo.com
+.ffxiv.com
+.finalfantasyxiv.com
+.gcloudcs.com
+.gcloudsdk.com
+.home.arpa
+.icitymobile.mobi
+.internal
+.invalid
+.jegotrip.com.cn
+.kk-rays.com
+.kuwo.cn
+.lan
+.linksys.com
+.linksyssmartwifi.com
+.local
+.localdomain
+.localhost
+.m2m
+.market.xiaomi.com
+.mcdn.bilivideo.cn
+.media.dssott.com
+.microdone.cn
+.msftconnecttest.com
+.msftncsi.com
+.music.163.com
+.music.migu.cn
+.n0808.com
+.nflxvideo.net
+.nip.io
+.ntp.org.cn
+.oray.com
+.orayimg.com
+.pingan.com.cn
+.pool.ntp.org
+.qq.com
+.router.asus.com
+.sandai.net
+.square-enix.com
+.srv.nintendo.net
+.sslip.io
+.steamcontent.com
+.stun.*.*
+.stun.*.*.*
+.stun.*.*.*.*
+.stun.*.*.*.*.*
+.tencent.com
+.test
+.time.edu.cn
+.ts.net
+.turn.twilio.com
+.uu.163.com
+.wargaming.net
+.wggames.cn
+.wosms.cn
+.wotgame.cn
+.wowsgame.cn
+.xboxlive.com
+.xiami.com
DC._msDCS.*.*
GC._msDCS.*.*
Mijia Cloud
PDC._msDCS.*.*
adguardteam.github.io
adrules.top
anti-ad.net
api-jooxtt.sanook.com
api.joox.com
app.yinxiang.com
cable.auth.com
detectportal.firefox.com
enrichgw.10010.com
ff.dorado.sdo.com
heartbeat.belkin.com
hmrz.wo.cn
id.mail.wo.cn
id6.me
injections.adguard.org
joox.com
lens.l.google.com
local.adguard.org
mdn.open.wo.cn
mesu.apple.com
music.taihe.com
musicapi.taihe.com
na.b.g-tun.com
network-test.debian.org
nishub1.10010.com
ntp.*.com
ntp1.*.com
ntp2.*.com
ntp3.*.com
ntp4.*.com
ntp5.*.com
ntp6.*.com
ntp7.*.com
open.e.189.cn
opencloud.wostore.cn
proxy.golang.org
ps.res.netease.com
resolver1.opendns.com
shark007.net
songsearch.kugou.com
static.adtidy.org
swcdn.apple.com
swdist.apple.com
swdownload.apple.com
swquery.apple.com
swscan.apple.com
time-ios.apple.com
time-macos.apple.com
time.*.apple.com
time.*.com
time.*.edu.cn
time.*.gov
time1.*.com
time2.*.com
time3.*.com
time4.*.com
time5.*.com
time6.*.com
time7.*.com
trackercdn.kugou.com
xbox.*.*.microsoft.com
xbox.*.microsoft.com
`;

export const MANAGED_REAL_IP_DOMAINS = parseManagedRealIpDomainList(QUIXOTIC_FAKE_IP_FILTER_SNAPSHOT);

export const DEFAULT_FAKE_IP_POLICY: ExportDnsPolicy = {
  additionalRealIpDomains: [],
  resolutionMode: 'split',
};

export type InlineRealIpClient =
  | 'stash'
  | 'loon'
  | 'surge'
  | 'shadowrocket'
  | 'quantumultx'
  | 'egern';

export function parseManagedRealIpDomainList(content: string): string[] {
  const domains = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/\s/.test(line))
    .map(normalizeManagedRealIpDomain)
    .filter((domain): domain is string => domain !== undefined);
  return [...new Set(domains)];
}

function normalizeManagedRealIpDomain(value: string): string | undefined {
  const suffix = value.startsWith('+.');
  const normalized = normalizeDnsRealIpDomain(suffix ? value.slice(2) : value);
  return normalized === undefined ? undefined : suffix ? `+.${normalized}` : normalized;
}

export function customRealIpDomains(policy: ExportDnsPolicy): string[] {
  return normalizeDnsRealIpDomainList(policy.additionalRealIpDomains) ?? [];
}

/** Translate Mihomo domain-set patterns into each inline client's native host syntax. */
export function inlineRealIpDomains(
  policy: ExportDnsPolicy,
  client: InlineRealIpClient,
  managedDomains: readonly string[] = MANAGED_REAL_IP_DOMAINS
): string[] {
  const translatedManagedDomains = managedDomains.flatMap((domain) => {
    if (domain === '*') {
      // In Mihomo, a bare * only matches hostnames without a dot. Surge has an
      // explicit equivalent; the other inline formats do not document one.
      return client === 'surge' ? ['<simple-hostname>'] : [];
    }
    if (!domain.startsWith('+.')) return [domain];

    const suffix = domain.slice(2);
    if (!suffix) return [];
    // Stash supports Mihomo's +. suffix syntax natively. Host-list clients need
    // both the apex and wildcard forms to preserve the same match set.
    return client === 'stash' ? [domain] : [suffix, `*.${suffix}`];
  });

  return [...new Set([...translatedManagedDomains, ...customRealIpDomains(policy)])];
}
