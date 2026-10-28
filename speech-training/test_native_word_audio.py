import copy,json,tempfile,unittest
from pathlib import Path
from build_native_word_audio import verified_files

ROOT=Path(__file__).resolve().parent.parent
class NativeWordAudioTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  source=ROOT/'app/assets/native-words';self.manifest=json.loads((source/'ATTRIBUTION.json').read_text())
  self.row=next(row for row in self.manifest['words'] if row.get('available'));self.manifest['words']=[copy.deepcopy(self.row)]
  self.directory=self.root/'app/assets/native-words';self.directory.mkdir(parents=True)
  self.audio=self.root/'app'/self.row['url'];self.audio.write_bytes((ROOT/'app'/self.row['url']).read_bytes())
  for n in ('ATTRIBUTION.md','CMUDICT-LICENSE.txt'):(self.directory/n).write_bytes((source/n).read_bytes())
  self.write()
 def write(self):(self.directory/'ATTRIBUTION.json').write_text(json.dumps(self.manifest))
 def test_only_manifest_listed_audio_and_credits_are_exported(self):
  (self.directory/'private.wav').write_bytes(b'not public')
  files=verified_files(self.root);self.assertIn('app/'+self.row['url'],files);self.assertFalse(any('private.wav'in p for p in files))
 def test_tampering_cannot_be_published(self):
  raw=bytearray(self.audio.read_bytes());raw[-1]^=1;self.audio.write_bytes(raw)
  with self.assertRaisesRegex(ValueError,'integrity'):verified_files(self.root)
 def test_missing_license_and_arbitrary_paths_are_rejected(self):
  self.manifest['words'][0]['license']='all rights reserved';self.write()
  with self.assertRaisesRegex(ValueError,'provenance or license'):verified_files(self.root)
  self.manifest['words'][0]=copy.deepcopy(self.row);self.manifest['words'][0]['url']='../recordings/private.wav';self.write()
  with self.assertRaises(ValueError):verified_files(self.root)
 def test_symlinked_audio_is_rejected(self):
  outside=self.root/'outside.wav';self.audio.rename(outside);self.audio.symlink_to(outside)
  with self.assertRaisesRegex(ValueError,'symlinked'):verified_files(self.root)

if __name__=='__main__':unittest.main()
