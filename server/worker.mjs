import { parentPort, workerData } from 'node:worker_threads';
import { solve } from './schedule.mjs';
parentPort.postMessage(solve(workerData.schedule, workerData.weights, workerData.options));
