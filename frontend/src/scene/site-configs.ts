import type { SiteConfig } from '../contracts/messages.gen';

// digital-twin/site-config/*.json을 그대로 읽는다. 복사본을 두지 않는다.
const modules = import.meta.glob<SiteConfig>('../../../digital-twin/site-config/*.json', {
  import: 'default',
});

const byName = new Map(
  Object.entries(modules).map(([path, load]) => [path.split('/').pop()!.replace(/\.json$/, ''), load]),
);

export function listSites(): string[] {
  return [...byName.keys()].sort();
}

export async function loadSiteConfig(site: string): Promise<SiteConfig> {
  const load = byName.get(site);
  if (!load) throw new Error(`site-config 없음: ${site} (있는 것: ${listSites().join(', ') || '없음'})`);
  const config = await load();
  if (config.site !== site) throw new Error(`site-config 파일 이름(${site})과 site(${config.site})가 다르다`);
  return config;
}
