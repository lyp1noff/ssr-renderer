import {statfsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {BrowserPool} from './browser-pool';

export class Telemetry {
    private lastSuccess = 0;
    private readonly statuses = new Map<number, number>();
    private count = 0;
    private seconds = 0;

    get recentSuccess(): boolean {return Date.now() - this.lastSuccess < 90000;}
    get needsCheck(): boolean {return Date.now() - this.lastSuccess >= 30000;}
    success(): void {this.lastSuccess = Date.now();}
    record(status: number, seconds: number): void {
        this.statuses.set(status, (this.statuses.get(status) || 0) + 1);
        this.count++;
        this.seconds += seconds;
    }

    metrics(pool: BrowserPool): string {
        const storage = statfsSync(tmpdir());
        return [
            `renderer_ready ${Number(this.recentSuccess)}`,
            `renderer_last_success_timestamp_seconds ${this.lastSuccess / 1000}`,
            `renderer_active_pages ${pool.active}`,
            `renderer_queued_requests ${pool.queued}`,
            `renderer_duration_seconds_sum ${this.seconds}`,
            `renderer_duration_seconds_count ${this.count}`,
            `renderer_tmp_free_inodes ${storage.ffree}`,
            `renderer_tmp_used_inode_ratio ${storage.files ? (storage.files - storage.ffree) / storage.files : 0}`,
            `renderer_tmp_free_bytes ${storage.bavail * storage.bsize}`,
            `renderer_process_resident_memory_bytes ${process.memoryUsage().rss}`,
            ...[...this.statuses].map(([status, count]) => `renderer_responses_total{status="${status}"} ${count}`),
            '',
        ].join('\n');
    }
}
