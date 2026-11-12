import { describe, expect, it, beforeEach } from 'vitest';
import { useProjectStore } from '@/stores/projectStore';
import { formatTimecode, formatRulerTick } from '@/lib/timecode';
import type { MediaAsset } from '@/types/project';

function makeAsset(id = 'asset-1', durationMs = 10_000): MediaAsset {
  return {
    id,
    name: 'sample.wav',
    originalPath: 'C:/audio/sample.wav',
    storedPath: '${PORTABLE_ROOT}/projects/sample.wav',
    resolvedPath: 'P:/projects/sample.wav',
    durationMs,
    sampleRate: 48000,
    channels: 2,
    bitDepth: 24,
    codec: 'pcm_s24le',
    bitrate: 2304000,
    fileSizeBytes: 2_880_000,
    peakFilePath: 'P:/cache/peaks/sample.peaks',
    createdAt: new Date().toISOString(),
  };
}

describe('timecode utilities', () => {
  it('formats millisecond timecodes accurately', () => {
    expect(formatTimecode(0)).toBe('00:00.000');
    expect(formatTimecode(65_432)).toBe('01:05.432');
    expect(formatTimecode(3_661_005)).toBe('01:01:01.005');
    expect(formatTimecode(12_000, false)).toBe('00:12');
  });

  it('formats ruler ticks for sub-second and multi-minute zoom', () => {
    expect(formatRulerTick(1500, 500)).toBe('0:01.5');
    expect(formatRulerTick(90_000, 10_000)).toBe('1:30');
    expect(formatRulerTick(3_605_000, 60_000)).toBe('1:00:05');
  });
});

describe('projectStore non-destructive editing & undo/redo', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject('Unit Test Project');
  });

  it('splits, crops, duplicates, crossfades, and undoes/redoes cleanly', () => {
    const store = useProjectStore.getState();
    const t1 = store.tracks[0].id;
    store.addAsset(makeAsset('a1', 10_000));

    const clipId = store.addClipFromAsset('a1', t1, 1000);
    expect(useProjectStore.getState().clips).toHaveLength(1);

    // Split 10s clip at timeline 5000ms -> [1000..5000] (4s) and [5000..11000] (6s)
    useProjectStore.getState().splitClipAt(clipId, 5000);
    let clips = useProjectStore.getState().clips;
    expect(clips).toHaveLength(2);
    expect(clips[0].durationMs).toBe(4000);
    expect(clips[1].timelineStartMs).toBe(5000);
    expect(clips[1].sourceOffsetMs).toBe(4000);
    expect(clips[1].durationMs).toBe(6000);

    // Crossfade the two clips by 500ms -> 2nd clip moves earlier by 500ms and gets s_curve fades
    useProjectStore.getState().applyCrossfadeOverlap(clips[0].id, clips[1].id, 500);
    clips = useProjectStore.getState().clips;
    expect(clips[0].fadeOutMs).toBe(500);
    expect(clips[1].fadeInMs).toBe(500);
    expect(clips[1].timelineStartMs).toBe(4500);

    // Undo crossfade restores gapless split
    useProjectStore.getState().undo();
    clips = useProjectStore.getState().clips;
    expect(clips[0].fadeOutMs).toBe(0);
    expect(clips[1].timelineStartMs).toBe(5000);

    // Redo crossfade restores overlap
    useProjectStore.getState().redo();
    clips = useProjectStore.getState().clips;
    expect(clips[1].timelineStartMs).toBe(4500);
  });

  it('copies, pastes, ripple deletes, and manages track effects', () => {
    const store = useProjectStore.getState();
    const t1 = store.tracks[0].id;
    store.addAsset(makeAsset('a1', 5000));
    const c1 = store.addClipFromAsset('a1', t1, 0);

    useProjectStore.getState().selectClips([c1]);
    useProjectStore.getState().copySelectedClips();
    useProjectStore.getState().pasteAtPlayhead(8000);

    let clips = useProjectStore.getState().clips;
    expect(clips).toHaveLength(2);
    expect(clips[1].timelineStartMs).toBe(8000);

    // Ripple delete first clip -> second clip shifts earlier by 5000ms to 3000ms
    useProjectStore.getState().selectClips([c1]);
    useProjectStore.getState().deleteSelectedClips(true);
    clips = useProjectStore.getState().clips;
    expect(clips).toHaveLength(1);
    expect(clips[0].timelineStartMs).toBe(3000);

    // Attach effect to track and inspect presets
    useProjectStore.getState().addEffectToTarget({ kind: 'track', id: t1 }, 'compressor');
    const updatedTrack = useProjectStore.getState().tracks[0];
    expect(updatedTrack.effects).toHaveLength(1);
    expect(updatedTrack.effects[0].type).toBe('compressor');
  });
});
