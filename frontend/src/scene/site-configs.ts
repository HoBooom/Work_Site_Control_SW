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

/**
 * 주소에 site가 없을 때 여는 사이트. VITE_DEFAULT_SITE(frontend/.env, infra/dev.sh가 Mock 서버 사이트로 덮어쓴다).
 * 없거나 모르는 이름이면 이름순 첫 번째
 */
export function defaultSite(): string | undefined {
  const want = import.meta.env.VITE_DEFAULT_SITE as string | undefined;
  return want && byName.has(want) ? want : listSites()[0];
}

export async function loadSiteConfig(site: string): Promise<SiteConfig> {
  const load = byName.get(site);
  if (!load) throw new Error(`site-config 없음: ${site} (있는 것: ${listSites().join(', ') || '없음'})`);
  const config = await load();
  if (config.site !== site) throw new Error(`site-config 파일 이름(${site})과 site(${config.site})가 다르다`);
  return config;
}
