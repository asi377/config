import mongoose from 'mongoose';
import { Server } from '../../models/index.js';
import { NotFoundError } from '../../utils/errors.js';

class AdminServerService {
  async getAllServers() {
    const servers = await Server.find().sort({ currentActiveUsers: -1 }).lean();
    return servers.map((s) => ({
      _id: s._id,
      name: s.name,
      ipAddress: s.ipAddress,
      port: s.port,
      xrayApiPort: s.xrayApiPort,
      maxCapacity: s.maxCapacity,
      currentActiveUsers: s.currentActiveUsers,
      loadPercent: s.maxCapacity > 0
        ? Number(((s.currentActiveUsers / s.maxCapacity) * 100).toFixed(1))
        : 100,
      status: s.status,
    }));
  }

  async addServer(data) {
    const server = await Server.create(data);
    return server;
  }

  async toggleSales(serverId, salesActive) {
    const server = await Server.findByIdAndUpdate(
      serverId,
      { $set: { status: salesActive ? 'active' : 'maintenance' } },
      { new: true },
    );
    if (!server) throw new NotFoundError('Server');
    return server;
  }

  async rebootServer(serverId) {
    const server = await Server.findById(serverId);
    if (!server) throw new NotFoundError('Server');
    // Simulated reboot — in production this would call the Xray API
    console.log(`[reboot] Server ${server.name} (${server.ipAddress}) rebooting...`);
    return { message: `Reboot signal sent to ${server.name}` };
  }
}

export default new AdminServerService();
