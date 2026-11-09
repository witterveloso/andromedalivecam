import unittest,tempfile,shutil,subprocess,sys,os
from pathlib import Path
SOURCE=Path(__file__).resolve().parents[1]/'cloud'/'configure.py'
class ConfigureTests(unittest.TestCase):
 def run_config(self, directory, page='https://owner.github.io/andromeda-cam/'):
  return subprocess.run([sys.executable,str(directory/'configure.py')],input='cam.example.com\nturn.example.com\n8.8.8.8\n'+page+'\n',text=True,capture_output=True)
 def test_secrets_pages_and_no_overwrite(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);shutil.copy(SOURCE,p/'configure.py');r=self.run_config(p);self.assertEqual(r.returncode,0,r.stderr)
   env=(p/'.env').read_text();self.assertIn('CAM_PAGE_URL=https://owner.github.io/andromeda-cam/',env)
   values=dict(line.split('=',1) for line in env.splitlines());self.assertEqual(len(values['CLOUD_TOKEN']),64);self.assertNotEqual(values['TURN_SECRET'],values['CLOUD_TOKEN'])
   self.assertEqual(os.stat(p/'.env').st_mode & 0o777,0o600)
   self.assertNotEqual(self.run_config(p).returncode,0);self.assertEqual((p/'.env').read_text(),env)
 def test_reject_insecure_page(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);shutil.copy(SOURCE,p/'configure.py');self.assertNotEqual(self.run_config(p,'http://example.com').returncode,0);self.assertFalse((p/'.env').exists())
if __name__=='__main__':unittest.main()
