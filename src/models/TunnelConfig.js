import mongoose from 'mongoose';

const tunnelConfigSchema = new mongoose.Schema({
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', required: true, index: true },
  name: String,
  protocol: { type: String, enum: ['vmess', 'vless', 'trojan', 'shadowsocks'], required: true },
  server: String,
  port: Number,
  uuid: { type: String, index: true },
  isGuestLink: { type: Boolean, default: false, index: true },
  guestExpireDate: { type: Date, index: true },
  allocatedQuotaBytes: { type: Number, default: 0 },
  usedQuotaBytes: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('TunnelConfig', tunnelConfigSchema);
