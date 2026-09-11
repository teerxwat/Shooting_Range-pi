"""คลาส Channel = คุมกล้องหลายตัวในเลนเดียว ให้ทำงาน 'พร้อมกัน' (parallel)"""
from concurrent.futures import ThreadPoolExecutor


def run_parallel(cameras, action):
    """ยิง action(camera) ให้ทุกตัวพร้อมกันด้วย thread คืน list ผลลัพธ์"""
    if not cameras:
        return []
    with ThreadPoolExecutor(max_workers=len(cameras)) as pool:
        return list(pool.map(action, cameras))


class Channel:
    def __init__(self, name, cameras):
        self.name = name
        self.cameras = cameras          # list[GoProCamera]

    @property
    def active_cameras(self):
        """เฉพาะกล้องที่เปิดใช้งาน (enabled) เท่านั้น"""
        return [c for c in self.cameras if c.enabled]

    def prepare(self, preset_id=None):
        """เปิด wired control + โหลด preset ให้ทุกกล้องพร้อมกัน"""
        def _prep(cam):
            cam.enable_wired_control()
            if preset_id:
                cam.load_preset(preset_id)
        run_parallel(self.active_cameras, _prep)

    def snapshot_media(self):
        """จดรายการไฟล์ก่อนถ่าย -> {cam_name: set(files)}"""
        cams = self.active_cameras
        results = run_parallel(cams, lambda c: c.list_media())
        return {cam.name: files for cam, files in zip(cams, results)}

    def start_recording(self):
        return run_parallel(self.active_cameras, lambda c: c.start_recording())

    def stop_recording(self):
        return run_parallel(self.active_cameras, lambda c: c.stop_recording())

    def keep_alive(self):
        return run_parallel(self.active_cameras, lambda c: c.keep_alive())