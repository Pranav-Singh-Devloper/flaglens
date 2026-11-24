# Contact sheet: the frame at each logged mark of a take (for reviewing footage).
import json, subprocess, sys, os
take = sys.argv[1]; track = sys.argv[2] if len(sys.argv) > 2 else 'vscode'
ev = json.load(open(f'recordings/{take}/{take}.events.json'))
idx = json.load(open(f'recordings/{take}/{track}/index.json'))
t0 = idx['startedAt']
marks = [(e.get('name', e['type']), e['t'] - t0 + 0.5) for e in ev if e['type'] in ('mark',)] or [('mid', 3.0)]
os.makedirs('out/sheets', exist_ok=True)
files = []
for i, (name, t) in enumerate(marks[:8]):
    f = f'out/sheets/{take}-{track}-{i}.jpg'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{t:.2f}', '-i', f'public/footage/{take}-{track}.mp4', '-frames:v', '1', '-vf', 'scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2', f])
    files.append(f)
cols = 3 if len(files) > 4 else 2
inputs = sum([['-i', f] for f in files], [])
n = len(files); rows = (n + cols - 1) // cols
pad = files + [files[-1]] * (rows * cols - n)
inputs = sum([['-i', f] for f in pad], [])
layout = '|'.join(f'{(i % cols) * 960}_{(i // cols) * 540}' for i in range(len(pad)))
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', f'xstack=inputs={len(pad)}:layout={layout}', f'out/sheets/{take}-{track}.jpg'])
print(f'out/sheets/{take}-{track}.jpg', [m[0] for m in marks])
