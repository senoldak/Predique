import React, { useState, useEffect } from 'react';
import { X, Bot, Shield, Zap, Eye, EyeOff, Check, RefreshCw, Send } from 'lucide-react';

export interface UserSettingsData {
  botStatus: 'ONLINE' | 'OFFLINE' | 'ERROR';
  botUsername?: string;
  botError?: string;
  botTokenMasked: string;
  defaultSlippage: number;
  defaultAmount: number;
  moonbagDefault: boolean;
  channelId?: string;
  channelAutoBroadcast?: boolean;
  minSignalTier?: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettingsData;
  onSave: (payload: {
    botToken?: string;
    defaultSlippage?: number;
    defaultAmount?: number;
    moonbagDefault?: boolean;
    channelId?: string;
    channelAutoBroadcast?: boolean;
    minSignalTier?: string;
  }) => Promise<void>;
  onTestChannel?: (channelId: string) => Promise<{ success: boolean; messageId?: number; error?: string }>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
  onTestChannel,
}) => {
  const [tokenInput, setTokenInput] = useState<string>('');
  const [showToken, setShowToken] = useState<boolean>(false);
  const [slippage, setSlippage] = useState<number>(settings.defaultSlippage || 5);
  const [amount, setAmount] = useState<number>(settings.defaultAmount || 0.1);
  const [moonbag, setMoonbag] = useState<boolean>(settings.moonbagDefault ?? true);
  const [channelInput, setChannelInput] = useState<string>(settings.channelId || '@predique');
  const [autoBroadcast, setAutoBroadcast] = useState<boolean>(settings.channelAutoBroadcast ?? true);
  const [minTier, setMinTier] = useState<string>(settings.minSignalTier || 'ALL');

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSlippage(settings.defaultSlippage || 5);
      setAmount(settings.defaultAmount || 0.1);
      setMoonbag(settings.moonbagDefault ?? true);
      setChannelInput(settings.channelId || '@predique');
      setAutoBroadcast(settings.channelAutoBroadcast ?? true);
      setMinTier(settings.minSignalTier || 'ALL');
      setTokenInput('');
      setSavedSuccess(false);
      setTestResult(null);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        botToken: tokenInput.trim() ? tokenInput.trim() : undefined,
        defaultSlippage: slippage,
        defaultAmount: amount,
        moonbagDefault: moonbag,
        channelId: channelInput.trim() || '@predique',
        channelAutoBroadcast: autoBroadcast,
        minSignalTier: minTier,
      });
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 1200);
    } catch (e) {
      alert(`Failed to save settings: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!onTestChannel) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await onTestChannel(channelInput.trim() || '@predique');
      setTestResult(res);
    } catch (e) {
      setTestResult({ success: false, error: (e as Error).message });
    } finally {
      setIsTesting(false);
    }
  };

  const isOnline = settings.botStatus === 'ONLINE';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1rem' }}>⚙️</span>
            <span style={{ fontWeight: 700, letterSpacing: '-0.3px', fontSize: '0.95rem' }}>
              PREDIQUE CONFIGURATION
            </span>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Telegram Bot Card */}
          <div className="settings-section">
            <div className="settings-section-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Bot size={15} color="var(--amber-primary)" />
                <span style={{ fontWeight: 700 }}>TELEGRAM BOT INTEGRATION</span>
              </div>
              <div className="bot-status-indicator">
                <span
                  className="status-dot"
                  style={{ background: isOnline ? 'var(--emerald-profit)' : 'var(--text-dim)' }}
                />
                <span style={{ color: isOnline ? 'var(--emerald-profit)' : 'var(--text-dim)', fontWeight: 700 }}>
                  {isOnline ? `@${settings.botUsername || 'ONLINE'}` : 'INACTIVE'}
                </span>
              </div>
            </div>

            <div className="settings-field">
              <label className="field-label">
                <span>Bot Token (from @BotFather)</span>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>
                  Current: {settings.botTokenMasked}
                </span>
              </label>
              <div className="token-input-wrapper">
                <input
                  type={showToken ? 'text' : 'password'}
                  className="terminal-input"
                  placeholder="Paste new bot token to connect/change..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="token-eye-btn"
                  onClick={() => setShowToken(!showToken)}
                  title={showToken ? 'Hide token' : 'Show token'}
                >
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className="field-hint">
                <Shield size={11} color="var(--emerald-profit)" />
                <span>Tokens are stored locally in .env and never sent to GitHub or public APIs.</span>
              </div>
            </div>
          </div>

          {/* Telegram Channel Broadcast Section */}
          <div className="settings-section">
            <div className="settings-section-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Send size={14} color="var(--purple-sol)" />
                <span style={{ fontWeight: 700 }}>TELEGRAM CHANNEL BROADCAST</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: autoBroadcast ? 'var(--emerald-profit)' : 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                  }}
                >
                  {autoBroadcast ? 'LIVE BROADCAST ON' : 'MUTED'}
                </span>
                <input
                  type="checkbox"
                  checked={autoBroadcast}
                  onChange={(e) => setAutoBroadcast(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: 'var(--amber-primary)' }}
                />
              </div>
            </div>

            <div className="settings-field">
              <label className="field-label">
                <span>Target Channel Username or ID</span>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>e.g. @predique</span>
              </label>
              <input
                type="text"
                className="terminal-input"
                placeholder="@predique or -100xxxxxxxx"
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
              />
            </div>

            <div className="settings-field">
              <label className="field-label">Signal Quality Filter (Prevent Channel Spam)</label>
              <div className="preset-pills">
                {[
                  { id: 'ALL', label: 'ALL SIGNALS' },
                  { id: 'TIER_3', label: '⭐⭐⭐ TIER 3+' },
                  { id: 'TIER_4', label: '⭐⭐⭐⭐ TIER 4+' },
                ].map((tier) => (
                  <button
                    key={tier.id}
                    type="button"
                    className={`preset-pill ${minTier === tier.id ? 'active' : ''}`}
                    onClick={() => setMinTier(tier.id)}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: '10px' }}>
              <button
                type="button"
                className="test-channel-btn"
                onClick={handleSendTest}
                disabled={isTesting || !isOnline}
                title={!isOnline ? 'Connect bot first to test broadcast' : 'Send test alert to channel'}
              >
                {isTesting ? (
                  <>
                    <RefreshCw size={12} className="spin" />
                    <span>SENDING TEST BROADCAST...</span>
                  </>
                ) : (
                  <>
                    <Send size={12} />
                    <span>🧪 SEND TEST ALERT TO {channelInput || '@predique'}</span>
                  </>
                )}
              </button>

              {testResult && (
                <div className={`channel-result-badge ${testResult.success ? 'success' : 'error'}`}>
                  {testResult.success ? (
                    <span>✅ Test message delivered to {channelInput || '@predique'}! Check channel.</span>
                  ) : (
                    <span>⚠️ {testResult.error}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Trade Execution Defaults */}
          <div className="settings-section">
            <div className="settings-section-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Zap size={15} color="var(--cyan-evm)" />
                <span style={{ fontWeight: 700 }}>EXECUTION PREFERENCES</span>
              </div>
            </div>

            <div className="settings-field">
              <label className="field-label">Default Order Amount (Native SOL / ETH)</label>
              <div className="preset-pills">
                {[0.05, 0.1, 0.25, 0.5, 1.0].map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`preset-pill ${amount === val ? 'active' : ''}`}
                    onClick={() => setAmount(val)}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-field">
              <label className="field-label">Slippage Tolerance</label>
              <div className="preset-pills">
                {[1, 3, 5, 10, 15].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`preset-pill ${slippage === s ? 'active' : ''}`}
                    onClick={() => setSlippage(s)}
                  >
                    {s}%
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-field" style={{ marginBottom: 0 }}>
              <div className="moonbag-row" style={{ padding: '8px 0' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.8rem' }}>
                    Auto Take-Profit Moonbag Protection
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                    Automatically sell 50% initial principal when token doubles (+100% / 2X)
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={moonbag}
                  onChange={(e) => setMoonbag(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: 'var(--amber-primary)' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
            CANCEL
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <RefreshCw size={13} className="spin" />
                <span>SAVING & RECONNECTING...</span>
              </>
            ) : savedSuccess ? (
              <>
                <Check size={13} color="var(--emerald-profit)" />
                <span>SAVED!</span>
              </>
            ) : (
              <span>SAVE CONFIGURATION</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
