import type { AgentProfile } from '../types/relay';
import museAvatar from '../assets/images/muse_agent_avatar_1795671239700.jpg';

export interface AvatarPreset {
  id: string;
  label: string;
  src: string;
}

const AMBER_DAWN_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><radialGradient id="g" cx="35%" cy="30%" r="70%"><stop offset="0%" stop-color="#FEF3C7"/><stop offset="48%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#9A3412"/></radialGradient></defs><rect width="120" height="120" rx="60" fill="#F8F7F4"/><circle cx="60" cy="60" r="46" fill="url(#g)"/><ellipse cx="46" cy="40" rx="18" ry="11" fill="#FFFFFF" fill-opacity="0.38" transform="rotate(-24 46 40)"/></svg>`
  );

const EMERALD_GLASS_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><radialGradient id="g" cx="35%" cy="28%" r="72%"><stop offset="0%" stop-color="#D1FAE5"/><stop offset="45%" stop-color="#10B981"/><stop offset="100%" stop-color="#064E3B"/></radialGradient></defs><rect width="120" height="120" rx="60" fill="#F8F7F4"/><circle cx="60" cy="60" r="46" fill="url(#g)"/><ellipse cx="46" cy="40" rx="18" ry="11" fill="#FFFFFF" fill-opacity="0.35" transform="rotate(-24 46 40)"/></svg>`
  );

const OBSIDIAN_RING_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="60" fill="#0F172A"/><circle cx="52" cy="64" r="24" fill="none" stroke="#3B82F6" stroke-width="8"/><circle cx="68" cy="56" r="24" fill="none" stroke="#F8FAFC" stroke-width="8"/></svg>`
  );

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'muse-pearl', label: '珠光蓝球', src: museAvatar },
  { id: 'amber-dawn', label: '暖光晨曦', src: AMBER_DAWN_SVG },
  { id: 'emerald-glass', label: '青玉琉璃', src: EMERALD_GLASS_SVG },
  { id: 'obsidian-ring', label: '曜石双环', src: OBSIDIAN_RING_SVG },
];

export const DEFAULT_AGENT_PROFILE: AgentProfile = {
  name: 'Relay',
  subtitle: '私人 AI 助理',
  avatarId: 'muse-pearl',
};

export function resolveAvatarSrc(profile: AgentProfile): string {
  if (profile.avatarId === 'custom' && profile.customAvatarUrl) {
    return profile.customAvatarUrl;
  }
  const preset = AVATAR_PRESETS.find((p) => p.id === profile.avatarId);
  return preset ? preset.src : museAvatar;
}
