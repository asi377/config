import NodeRegistrationService from './NodeRegistrationService.js';
import NodeCommandService from './NodeCommandService.js';
import NodeHealthService from './NodeHealthService.js';

class NodeManagerService {
  // Registration
  registerNode(params) { return NodeRegistrationService.registerNode(params); }
  addServer(serverData) { return NodeRegistrationService.addServer(serverData); }
  removeServer(serverId) { return NodeRegistrationService.removeServer(serverId); }
  _generateBootstrapCommand(server) { return NodeRegistrationService._generateBootstrapCommand(server); }

  // Commands
  executeNodeCommand(serverId, commandName, params) { return NodeCommandService.executeNodeCommand(serverId, commandName, params); }
  rotateNodeCredentials(serverId) { return NodeCommandService.rotateNodeCredentials(serverId); }
  rotateAllNodeCredentials() { return NodeCommandService.rotateAllNodeCredentials(); }
  reportCommandResult(params) { return NodeCommandService.reportCommandResult(params); }

  // Health
  processHeartbeat(params) { return NodeHealthService.processHeartbeat(params); }
  handleShutdown(params) { return NodeHealthService.handleShutdown(params); }
  syncUsers(params) { return NodeHealthService.syncUsers(params); }
  getServerStatus(serverId) { return NodeHealthService.getServerStatus(serverId); }
  getInfraSummary() { return NodeHealthService.getInfraSummary(); }
  getProvisionLogs(serverId, opts) { return NodeHealthService.getProvisionLogs(serverId, opts); }
}

export default new NodeManagerService();
