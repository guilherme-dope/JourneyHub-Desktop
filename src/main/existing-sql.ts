import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { Database } from './database';
import { JourneyRepository } from './repository';
import { DomainError } from '../domain/journey';

export async function connectExistingSql(connectionFile: string) {
  const settings = parse(await readFile(resolve(connectionFile)));
  const database = new Database(settings);
  const repository = new JourneyRepository(database);
  try {
    const health = await repository.health();
    if (!health.ready) throw new DomainError('DATABASE_NOT_READY', health.message);
    return { database, repository };
  } catch (error) { await database.close(); throw error; }
}

