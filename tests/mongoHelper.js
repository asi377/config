// MongoDB in-memory server for integration tests.
// This file should only be imported when mongodb-memory-server is installed.
// Tests that need DB should use this file.
// If the module is not available, tests will be skipped.

let mongoServer;

export async function startMongo() {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongoServer = await MongoMemoryServer.create();
    return mongoServer.getUri();
  } catch {
    return null; // mongodb-memory-server not available
  }
}

export async function stopMongo() {
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}
