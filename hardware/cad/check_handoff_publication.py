"""Exercise partial-copy and late-write failures at the handoff publication boundary."""
import errno
import json
from pathlib import Path
import shutil
import sys
import tempfile
from unittest.mock import patch

import five_part_print as packet


def check(source_zip,report_path):
    source=packet.pin(source_zip);results=[]
    original_copy=shutil.copyfile;original_write=Path.write_text;original_replace=Path.replace
    with tempfile.TemporaryDirectory(prefix='disco-publication-controls-') as directory:
        root=Path(directory)
        for label in ('partial-copy','late-notes-write','receipt-commit','success','existing-target'):
            base=root/label;base.mkdir();analysis=base/'analysis';analysis.mkdir();delivery=base/'handoff'
            observed=[]
            def partial_copy(src,dst,*args,**kwargs):
                Path(dst).write_bytes(Path(src).read_bytes()[:64])
                observed.append(not delivery.exists())
                raise OSError(errno.ENOSPC,'injected disk full after 64 copied bytes')
            def late_notes(path,text,*args,**kwargs):
                if path.name=='PRINT-NOTES.txt':
                    original_write(path,text[:5],*args,**kwargs)
                    observed.append(not delivery.exists())
                    raise OSError(errno.ENOSPC,'injected disk full during notes write')
                return original_write(path,text,*args,**kwargs)
            def late_receipt(path,target):
                if path.name.startswith('.proposal-release-'):
                    assert delivery.exists() and len(list(delivery.iterdir()))==2
                    raise OSError(errno.ENOSPC,'injected receipt rename failure')
                return original_replace(path,target)
            if label=='existing-target':delivery.mkdir();(delivery/'sentinel').write_text('preserve')
            try:
                with patch('shutil.copyfile',partial_copy if label=='partial-copy' else original_copy), \
                     patch.object(Path,'write_text',late_notes if label=='late-notes-write' else original_write), \
                     patch.object(Path,'replace',late_receipt if label=='receipt-commit' else original_replace):
                    packet.publish_handoff(analysis,delivery,source,'Complete printer notes.\n',dict(production_ready=False))
            except OSError as error:
                assert label in ('partial-copy','late-notes-write','receipt-commit') and error.errno==errno.ENOSPC
                assert not delivery.exists() and not (analysis/'proposal-release.json').exists()
                assert all(observed)
            except ValueError:
                assert label=='existing-target' and (delivery/'sentinel').read_text()=='preserve'
                assert len(list(delivery.iterdir()))==1
            else:
                assert label=='success' and len(list(delivery.iterdir()))==2
                report=json.loads((analysis/'proposal-release.json').read_text())
                assert packet.pin(report['delivered_zip']['path'])==report['delivered_zip']
                assert report['delivered_zip']['sha256']==source['sha256']
                assert Path(report['printer_notes']['path']).read_text()=='Complete printer notes.\n'
            assert not list(base.glob('.disco-handoff-*')) and not list(analysis.glob('.proposal-release-*'))
            assert packet.pin(source_zip)==source
            results.append(dict(case=label,passed=True,final_directory_absent_on_injected_failure=label in ('partial-copy','late-notes-write','receipt-commit')))
    assert not report_path.exists()
    report_path.write_text(json.dumps(dict(source_zip=source,cases=results),indent=2)+'\n')
    print('PASS: partial 64-byte copy, late notes write, receipt failure, success, and existing-target preservation')


if __name__=='__main__':check(Path(sys.argv[1]),Path(sys.argv[2]))
