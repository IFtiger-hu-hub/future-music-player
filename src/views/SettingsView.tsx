import React from 'react';
import {
  Palette,
  Check,
  RotateCcw,
  Sliders,
  Disc3,
  SlidersHorizontal,
} from 'lucide-react';
import { usePlayerStore } from '../store/usePlayerStore';
import { THEME_PALETTES, CUSTOM_ACCENT_SWATCHES } from '../theme/palettes';

export const SettingsView: React.FC = () => {
  const setActiveNav = usePlayerStore((s) => s.setActiveNav);
  const themeId = usePlayerStore((s) => s.themeId);
  const setThemeId = usePlayerStore((s) => s.setThemeId);
  const fontScale = usePlayerStore((s) => s.fontScale);
  const setFontScale = usePlayerStore((s) => s.setFontScale);
  const customAccent = usePlayerStore((s) => s.customAccent);
  const setCustomAccent = usePlayerStore((s) => s.setCustomAccent);
  const resetAppearance = usePlayerStore((s) => s.resetAppearance);
  const eqPreset = usePlayerStore((s) => s.eqPreset);
  const eqBands = usePlayerStore((s) => s.eqBands);
  const setEqBandGain = usePlayerStore((s) => s.setEqBandGain);
  const applyEqPreset = usePlayerStore((s) => s.applyEqPreset);
  const mergeAudits = usePlayerStore((s) => s.mergeAudits);
  const revokeMergeDecision = usePlayerStore((s) => s.revokeMergeDecision);

  return (
    <div className="space-y-6">
      {/* HarmonyOS Top Capsule Switcher for Cafe馆 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setActiveNav('sources')}
            className="h-9 px-5 rounded-full surface-bento hover:bg-white/[0.1] text-white/75 text-[13px] font-semibold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Disc3 className="w-3.5 h-3.5" />
            <span>音源与账号管理</span>
          </button>
          <button
            onClick={() => setActiveNav('settings')}
            className="h-9 px-5 rounded-full bg-[#24262A] !text-white text-[13px] font-semibold flex items-center gap-2 shadow-xs cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 !text-white" />
            <span>音效与主题外观</span>
          </button>
        </div>

        <button
          onClick={() => {
            resetAppearance();
            setThemeId('light');
          }}
          className="h-9 px-4 rounded-full surface-bento hover:bg-white/[0.1] text-[12px] font-medium text-white/80 flex items-center gap-1.5 cursor-pointer transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>恢复鸿蒙默认浅色</span>
        </button>
      </div>

      {/* Theme System & Appearance Card */}
      <div className="p-6 rounded-[24px] surface-bento space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Palette
              className="w-4 h-4"
              style={{ color: 'var(--theme-accent)' }}
            />
            <h3 className="text-[16px] font-bold text-white">
              鸿蒙全场景主题色板 (13 款预设)
            </h3>
          </div>
          <span className="badge-lossless">深浅色自适应</span>
        </div>

        {/* Light Themes */}
        <div className="space-y-2.5">
          <div className="text-[12px] font-medium text-white/55">
            浅色模式 (晨光 · 晴海 · 鼠尾草 · 暖砂 · 蔷薇 · 冰川)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {THEME_PALETTES.filter((t) => !t.dark).map((p) => {
              const selected = themeId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setThemeId(p.id)}
                  style={{
                    backgroundColor: p.base,
                    color: p.text,
                    borderColor: selected ? p.accent : 'rgba(0,0,0,0.1)',
                  }}
                  className={`p-3 rounded-[16px] border-2 text-left transition-all cursor-pointer flex flex-col justify-between h-20 shadow-xs hover:scale-[1.02] ${
                    selected ? 'shadow-md' : ''
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className="w-4 h-4 rounded-full shadow-xs"
                      style={{ backgroundColor: p.accent }}
                    />
                    {selected && (
                      <Check className="w-4 h-4" style={{ color: p.accent }} />
                    )}
                  </div>
                  <div>
                    <div
                      className="text-[13px] font-semibold"
                      style={{ color: p.text }}
                    >
                      {p.label}
                    </div>
                    <div
                      className="text-[10px] font-mono-tabular opacity-65"
                      style={{ color: p.secondary }}
                    >
                      {p.base}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dark Themes */}
        <div className="space-y-2.5">
          <div className="text-[12px] font-medium text-white/55">
            深色模式 (绯红暗夜 · 午夜蓝 · 深林 · 石墨 · 夜玫瑰 · 咖啡 · 曜石)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
            {THEME_PALETTES.filter((t) => t.dark).map((p) => {
              const selected = themeId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setThemeId(p.id)}
                  style={{
                    backgroundColor: p.base,
                    color: p.text,
                    borderColor: selected
                      ? p.accent
                      : 'rgba(255,255,255,0.12)',
                  }}
                  className={`p-3 rounded-[16px] border-2 text-left transition-all cursor-pointer flex flex-col justify-between h-20 shadow-xs hover:scale-[1.02] ${
                    selected ? 'shadow-md' : ''
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className="w-4 h-4 rounded-full shadow-xs"
                      style={{ backgroundColor: p.accent }}
                    />
                    {selected && (
                      <Check className="w-4 h-4" style={{ color: p.accent }} />
                    )}
                  </div>
                  <div>
                    <div
                      className="text-[13px] font-semibold"
                      style={{ color: p.text }}
                    >
                      {p.label}
                    </div>
                    <div
                      className="text-[10px] font-mono-tabular opacity-65"
                      style={{ color: p.secondary }}
                    >
                      {p.base}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font Scale & Custom Accent Row */}
        <div className="pt-4 border-t border-white/[0.06] grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium text-white">界面字号缩放</span>
              <span className="font-mono-tabular text-white/60">
                {Math.round(fontScale * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.85}
              max={1.15}
              step={0.05}
              value={fontScale}
              onChange={(e) => setFontScale(parseFloat(e.target.value))}
              className="w-full cursor-pointer"
              style={{ accentColor: 'var(--theme-accent)' }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium text-white">自定义品牌点缀色</span>
              <button
                onClick={() => setCustomAccent(null)}
                className="text-[11px] text-white/50 hover:text-white cursor-pointer"
              >
                跟随主题默认
              </button>
            </div>
            <div className="flex items-center gap-2.5">
              {CUSTOM_ACCENT_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  onClick={() => setCustomAccent(hex)}
                  style={{ backgroundColor: hex }}
                  className={`w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 ${
                    customAccent === hex ? 'ring-2 ring-[#FA2D48]' : ''
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 10-Band Parametric Equalizer */}
      <div className="p-6 rounded-[24px] surface-bento space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <Sliders
              className="w-4 h-4"
              style={{ color: 'var(--theme-accent)' }}
            />
            <h3 className="text-[16px] font-bold text-white">
              Audio Vivid 10 段参量均衡器
            </h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(
              [
                { id: 'harman', label: 'Harman 曲线' },
                { id: 'flat', label: '原音直通' },
                { id: 'vocal', label: '清澈人声' },
                { id: 'bass', label: '超重低音' },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyEqPreset(preset.id)}
                style={
                  eqPreset === preset.id
                    ? { backgroundColor: 'var(--theme-accent)' }
                    : undefined
                }
                className={`px-3.5 py-1 rounded-full text-[12px] font-medium cursor-pointer transition-colors ${
                  eqPreset === preset.id
                    ? '!text-white shadow-xs'
                    : 'bg-white/[0.06] text-white/65 hover:text-white border border-white/[0.07]'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2.5 pt-2">
          {eqBands.map((band) => (
            <div
              key={band.freqHz}
              className="flex flex-col items-center p-3 rounded-[16px] bg-white/[0.04] border border-white/[0.06]"
            >
              <span className="text-[11px] font-mono-tabular text-white/80 mb-2">
                {band.gainDb >= 0 ? `+${band.gainDb}` : band.gainDb}dB
              </span>
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={band.gainDb}
                onChange={(e) =>
                  setEqBandGain(band.freqHz, parseFloat(e.target.value))
                }
                style={{ accentColor: 'var(--theme-accent)' }}
                className="w-full cursor-pointer"
              />
              <span className="text-[10.5px] font-mono-tabular text-white/50 mt-2">
                {band.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Reversible Merge Decisions */}
      <div className="p-6 rounded-[24px] surface-bento space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-bold text-white">
              跨平台同名歌曲合并记录
            </h3>
            <p className="text-[12px] text-white/50 mt-0.5">
              不同平台的同名曲目已自动合并挂载，您可随时拆分还原。
            </p>
          </div>
          <span className="badge-lossless">可逆合并</span>
        </div>
        <div className="space-y-2.5">
          {mergeAudits.map((audit) => (
            <div
              key={audit.id}
              className="p-3.5 rounded-[16px] bg-white/[0.04] border border-white/[0.06] flex items-center justify-between gap-4"
            >
              <div>
                <div className="flex items-center gap-2 text-[13.5px] text-white font-medium">
                  <span>{audit.winnerTitle}</span>
                  <span className="text-white/35">←</span>
                  <span className="text-white/70">{audit.loserTitle}</span>
                </div>
                <div className="text-[11px] text-white/45 mt-1">
                  {audit.createdAt}
                </div>
              </div>

              {audit.revoked ? (
                <span className="text-xs text-white/45 px-3 py-1 rounded-full bg-white/[0.05]">
                  已拆分还原
                </span>
              ) : (
                <button
                  onClick={() => revokeMergeDecision(audit.id)}
                  className="h-8 px-4 rounded-full bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.07] text-xs font-medium text-white cursor-pointer transition-colors"
                >
                  拆分曲目
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
