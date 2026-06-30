import { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import toast from 'react-hot-toast';
import { GripVertical, Plus, Trash2, Save, Smartphone, Menu, MessageSquare } from 'lucide-react';
import api from '../api/client';

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'fa', label: 'فارسی' },
  { code: 'ru', label: 'Русский' },
];

const EMPTY_LOCALIZED = { en: '', fa: '', ru: '' };

const DEFAULT_BUTTON = () => ({
  buttonId: `action_${Date.now()}`,
  text: { ...EMPTY_LOCALIZED, en: 'New Button' },
  order: 0,
  row: 0,
  action: { type: 'staticAction', nextMenuId: '', staticAction: '' },
});

function MobilePreview({ welcomeText, menus, lang }) {
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
        <span className="text-xs text-gray-400 ml-2">Bot Preview ({lang.toUpperCase()})</span>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-primary-600/10 border border-primary-600/20 rounded-lg p-3 text-center">
          <MessageSquare className="w-5 h-5 text-primary-400 mx-auto mb-1" />
          <p className="text-xs text-gray-300 whitespace-pre-wrap">{welcomeText?.[lang]}</p>
        </div>
        <div className="space-y-2">
          {Array.from({ length: maxRow + 1 }, (_, rowIdx) => (
            <div key={rowIdx} className="flex gap-2 justify-center">
              {(grouped[rowIdx] || []).map((btn) => (
                <span key={btn.buttonId} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200">
                  {btn.text?.[lang] || btn.buttonId}
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
  const [welcomeText, setWelcomeText] = useState({ ...EMPTY_LOCALIZED });
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeLang, setActiveLang] = useState('en');

  const fetchConfig = useCallback(async () => {
    try {
      const res = await api.get('/enterprise/bot-config');
      const cfg = res.data.data;
      setWelcomeText({ ...EMPTY_LOCALIZED, ...(cfg.welcomeText || {}) });
      const sorted = (cfg.botMenus || [])
        .map((m) => ({
          ...m,
          text: { ...EMPTY_LOCALIZED, ...(m.text || {}) },
          action: m.action || { type: 'staticAction', nextMenuId: '', staticAction: '' },
        }))
        .sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.order ?? 0) - (b.order ?? 0));
      setMenus(sorted);
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

  const updateMenuText = (index, lang, value) => {
    const items = Array.from(menus);
    items[index] = { ...items[index], text: { ...items[index].text, [lang]: value } };
    setMenus(items);
  };

  const updateMenuAction = (index, field, value) => {
    const items = Array.from(menus);
    items[index] = { ...items[index], action: { ...items[index].action, [field]: value } };
    setMenus(items);
  };

  const addButton = () => {
    const maxOrder = menus.length;
    const maxRow = menus.reduce((max, m) => Math.max(max, m.row ?? 0), 0);
    setMenus([...menus, { ...DEFAULT_BUTTON(), order: maxOrder, row: maxRow }]);
  };

  const removeButton = (index) => {
    const items = menus.filter((_, i) => i !== index).map((item, idx) => ({ ...item, order: idx }));
    setMenus(items);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        welcomeText,
        botMenus: menus.map(({ buttonId, text, order, row, action }) => ({ buttonId, text, order, row, action })),
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

      <div className="flex items-center gap-2 mb-4">
        {LANGS.map((l) => (
          <button
            key={l.code}
            onClick={() => setActiveLang(l.code)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeLang === l.code
                ? 'bg-primary-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="flex gap-6 items-start">
        <div className="flex-1 space-y-6">
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary-400" />
              Welcome Text ({LANGS.find((l) => l.code === activeLang)?.label})
            </h2>
            <textarea
              className="input min-h-[100px] resize-y"
              value={welcomeText[activeLang] ?? ''}
              onChange={(e) => setWelcomeText({ ...welcomeText, [activeLang]: e.target.value })}
              placeholder={`Enter welcome message (${activeLang})...`}
              dir={activeLang === 'fa' ? 'rtl' : 'ltr'}
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
                      <Draggable key={btn.buttonId} draggableId={btn.buttonId} index={index}>
                        {(p) => (
                          <div ref={p.innerRef} {...p.draggableProps} className="flex flex-col gap-2 bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                            <div className="flex items-center gap-3">
                              <div {...p.dragHandleProps} className="text-gray-500 hover:text-gray-300 cursor-grab active:cursor-grabbing">
                                <GripVertical className="w-4 h-4" />
                              </div>
                              <input
                                className="input flex-1"
                                value={btn.text?.[activeLang] ?? ''}
                                onChange={(e) => updateMenuText(index, activeLang, e.target.value)}
                                placeholder={`Button text (${activeLang})`}
                                dir={activeLang === 'fa' ? 'rtl' : 'ltr'}
                              />
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
                            <div className="flex items-center gap-2 pl-7">
                              <select
                                className="input w-36 text-xs"
                                value={btn.action?.type || 'staticAction'}
                                onChange={(e) => updateMenuAction(index, 'type', e.target.value)}
                              >
                                <option value="staticAction">Static Action</option>
                                <option value="nextMenu">Next Menu</option>
                              </select>
                              {btn.action?.type === 'nextMenu' ? (
                                <input
                                  className="input flex-1 text-xs"
                                  value={btn.action?.nextMenuId ?? ''}
                                  onChange={(e) => updateMenuAction(index, 'nextMenuId', e.target.value)}
                                  placeholder="Next menu ID"
                                />
                              ) : (
                                <input
                                  className="input flex-1 text-xs"
                                  value={btn.action?.staticAction ?? ''}
                                  onChange={(e) => updateMenuAction(index, 'staticAction', e.target.value)}
                                  placeholder="Action / callback_data (e.g. buy_renew)"
                                />
                              )}
                            </div>
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
        </div>

        <div className="sticky top-6">
          <div className="flex items-center gap-2 mb-3 text-sm text-gray-400">
            <Smartphone className="w-4 h-4" />
            Live Preview
          </div>
          <MobilePreview welcomeText={welcomeText} menus={menus} lang={activeLang} />
        </div>
      </div>
    </div>
  );
}
