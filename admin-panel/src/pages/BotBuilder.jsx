import { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import toast from 'react-hot-toast';
import { GripVertical, Plus, Trash2, Save, Smartphone, Menu, MessageSquareText, Lock, Radio } from 'lucide-react';
import api from '../api/client';

const DEFAULT_BUTTON = {
  text: 'New Button', actionId: 'action_new', order: 0, row: 0, type: 'builtin', messageText: '', followUpButtons: [],
};

const DEFAULT_CHANNEL = { chatId: '', title: '', inviteLink: '' };

function MobilePreview({ welcomeText, menus }) {
  const grouped = menus.reduce((acc, btn) => {
    const row = btn.row ?? 0;
    if (!acc[row]) acc[row] = [];
    acc[row].push(btn);
    return acc;
  }, {});
  const maxRow = Math.max(...Object.keys(grouped).map(Number), 0);

  return (
    <div className="card p-0 overflow-hidden flex-shrink-0 w-72">
      <div className="bg-gray-800 px-4 py-2 flex items-center gap-2 border-b border-gray-700">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
        </div>
        <span className="text-xs text-gray-400 ml-2">Bot Preview</span>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-primary-600/10 border border-primary-600/20 rounded-lg p-3 text-center">
          <MessageSquareText className="w-5 h-5 text-primary-400 mx-auto mb-1" />
          <p className="text-xs text-gray-300 whitespace-pre-wrap">{welcomeText}</p>
        </div>
        <div className="space-y-2">
          {Array.from({ length: maxRow + 1 }, (_, rowIdx) => (
            <div key={rowIdx} className="flex gap-2 justify-center">
              {(grouped[rowIdx] || []).map((btn) => (
                <span key={btn.actionId} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200">
                  {btn.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BotBuilder() {
  const [welcomeText, setWelcomeText] = useState('');
  const [menus, setMenus] = useState([]);
  const [channelGateEnabled, setChannelGateEnabled] = useState(false);
  const [requiredChannels, setRequiredChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await api.get('/enterprise/bot-config');
      const cfg = res.data.data;
      setWelcomeText(cfg.welcomeText || '');
      const sorted = (cfg.botMenus || []).sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.order ?? 0) - (b.order ?? 0));
      setMenus(sorted.map((m) => ({ type: 'builtin', messageText: '', followUpButtons: [], ...m })));
      setChannelGateEnabled(!!cfg.channelGateEnabled);
      setRequiredChannels(cfg.requiredChannels || []);
    } catch {
      toast.error('Failed to load bot config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(menus);
    const [removed] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, removed);
    const reordered = items.map((item, idx) => ({ ...item, order: idx }));
    setMenus(reordered);
  };

  const updateMenuField = (index, field, value) => {
    const items = Array.from(menus);
    items[index] = { ...items[index], [field]: value };
    setMenus(items);
  };

  const addButton = () => {
    const maxOrder = menus.length;
    const maxRow = menus.reduce((max, m) => Math.max(max, m.row ?? 0), 0);
    setMenus([...menus, { ...DEFAULT_BUTTON, order: maxOrder, row: maxRow, actionId: `action_${Date.now()}` }]);
  };

  const removeButton = (index) => {
    const items = menus.filter((_, i) => i !== index).map((item, idx) => ({ ...item, order: idx }));
    setMenus(items);
  };

  const addFollowUpButton = (index) => {
    const items = Array.from(menus);
    const followUpButtons = [...(items[index].followUpButtons || []), { text: 'Next', actionId: `action_${Date.now()}` }];
    items[index] = { ...items[index], followUpButtons };
    setMenus(items);
  };

  const updateFollowUpButton = (index, fbIndex, field, value) => {
    const items = Array.from(menus);
    const followUpButtons = items[index].followUpButtons.map((fb, i) => (i === fbIndex ? { ...fb, [field]: value } : fb));
    items[index] = { ...items[index], followUpButtons };
    setMenus(items);
  };

  const removeFollowUpButton = (index, fbIndex) => {
    const items = Array.from(menus);
    items[index] = { ...items[index], followUpButtons: items[index].followUpButtons.filter((_, i) => i !== fbIndex) };
    setMenus(items);
  };

  const addChannel = () => setRequiredChannels([...requiredChannels, { ...DEFAULT_CHANNEL }]);

  const updateChannel = (index, field, value) => {
    setRequiredChannels(requiredChannels.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const removeChannel = (index) => setRequiredChannels(requiredChannels.filter((_, i) => i !== index));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        welcomeText,
        botMenus: menus.map(({ text, actionId, order, row, type, messageText, followUpButtons }) => ({
          text, actionId, order, row, type, messageText, followUpButtons,
        })),
        channelGateEnabled,
        requiredChannels,
      };
      await api.put('/enterprise/bot-config', payload);
      toast.success('Bot config saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Menu className="w-6 h-6 text-primary-400" />
            Bot Builder
          </h1>
          <p className="text-sm text-gray-400 mt-1">Design your Telegram bot menu and welcome message</p>
        </div>
        <button onClick={save} disabled={saving} className="btn-primary">
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Config'}
        </button>
      </div>

      <div className="flex gap-6 items-start">
        <div className="flex-1 space-y-6">
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <MessageSquareText className="w-4 h-4 text-primary-400" />
              Welcome Text
            </h2>
            <textarea
              className="input min-h-[100px] resize-y"
              value={welcomeText}
              onChange={(e) => setWelcomeText(e.target.value)}
              placeholder="Enter welcome message..."
            />
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Menu className="w-4 h-4 text-primary-400" />
                Menu Buttons
              </h2>
              <button onClick={addButton} className="btn-secondary text-xs py-1.5 px-3">
                <Plus className="w-3.5 h-3.5" />
                Add Button
              </button>
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="menus">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                    {menus.map((btn, index) => (
                      <Draggable key={btn.actionId} draggableId={btn.actionId} index={index}>
                        {(p) => (
                          <div ref={p.innerRef} {...p.draggableProps} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50 space-y-2">
                            <div className="flex items-center gap-3">
                              <div {...p.dragHandleProps} className="text-gray-500 hover:text-gray-300 cursor-grab active:cursor-grabbing">
                                <GripVertical className="w-4 h-4" />
                              </div>
                              <input
                                className="input flex-1"
                                value={btn.text}
                                onChange={(e) => updateMenuField(index, 'text', e.target.value)}
                                placeholder="Button text"
                              />
                              <select
                                className="input w-28"
                                value={btn.type || 'builtin'}
                                onChange={(e) => updateMenuField(index, 'type', e.target.value)}
                                title="Built-in actions map to existing bot handlers; custom actions show your own message + follow-up buttons."
                              >
                                <option value="builtin">Built-in</option>
                                <option value="custom">Custom</option>
                              </select>
                              <input
                                className="input w-20 text-center"
                                type="number"
                                min={0}
                                value={btn.row ?? 0}
                                onChange={(e) => updateMenuField(index, 'row', Math.max(0, parseInt(e.target.value) || 0))}
                                placeholder="Row"
                                title="Row number"
                              />
                              <button onClick={() => removeButton(index)} className="text-red-400 hover:text-red-300 transition-colors p-1">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>

                            {btn.type === 'custom' && (
                              <div className="pl-7 space-y-2 border-t border-gray-700/50 pt-2">
                                <textarea
                                  className="input min-h-[60px] resize-y text-sm"
                                  value={btn.messageText || ''}
                                  onChange={(e) => updateMenuField(index, 'messageText', e.target.value)}
                                  placeholder="Message shown when this button is tapped..."
                                />
                                <div className="space-y-1.5">
                                  {(btn.followUpButtons || []).map((fb, fbIndex) => (
                                    <div key={fbIndex} className="flex items-center gap-2">
                                      <input
                                        className="input flex-1 text-sm"
                                        value={fb.text}
                                        onChange={(e) => updateFollowUpButton(index, fbIndex, 'text', e.target.value)}
                                        placeholder="Follow-up button text"
                                      />
                                      <input
                                        className="input flex-1 text-sm"
                                        value={fb.actionId}
                                        onChange={(e) => updateFollowUpButton(index, fbIndex, 'actionId', e.target.value)}
                                        placeholder="actionId (e.g. buy_renew or another custom id)"
                                      />
                                      <button onClick={() => removeFollowUpButton(index, fbIndex)} className="text-red-400 hover:text-red-300 p-1">
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <button onClick={() => addFollowUpButton(index)} className="btn-secondary text-xs py-1 px-2">
                                  <Plus className="w-3 h-3" />
                                  Add Follow-up Button
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            {menus.length === 0 && (
              <p className="text-center text-gray-500 py-8 text-sm">No buttons yet. Click "Add Button" to start.</p>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary-400" />
                Channel-Join Gate
              </h2>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={channelGateEnabled}
                  onChange={(e) => setChannelGateEnabled(e.target.checked)}
                />
                Require channel membership
              </label>
            </div>

            {channelGateEnabled && (
              <div className="space-y-2">
                {requiredChannels.map((channel, index) => (
                  <div key={index} className="flex items-center gap-2 bg-gray-800/50 rounded-lg p-2 border border-gray-700/50">
                    <Radio className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <input
                      className="input flex-1 text-sm"
                      value={channel.chatId}
                      onChange={(e) => updateChannel(index, 'chatId', e.target.value)}
                      placeholder="Chat ID (e.g. @mychannel or -100123456789)"
                    />
                    <input
                      className="input flex-1 text-sm"
                      value={channel.title}
                      onChange={(e) => updateChannel(index, 'title', e.target.value)}
                      placeholder="Display title"
                    />
                    <input
                      className="input flex-1 text-sm"
                      value={channel.inviteLink}
                      onChange={(e) => updateChannel(index, 'inviteLink', e.target.value)}
                      placeholder="Invite link (https://t.me/...)"
                    />
                    <button onClick={() => removeChannel(index)} className="text-red-400 hover:text-red-300 p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button onClick={addChannel} className="btn-secondary text-xs py-1.5 px-3">
                  <Plus className="w-3.5 h-3.5" />
                  Add Required Channel
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="sticky top-6">
          <div className="flex items-center gap-2 mb-3 text-sm text-gray-400">
            <Smartphone className="w-4 h-4" />
            Live Preview
          </div>
          <MobilePreview welcomeText={welcomeText} menus={menus} />
        </div>
      </div>
    </div>
  );
}
