"""Reject the historical above-opening retainer and fixed-tab mistakes."""
from build123d import Align,Box,Cylinder
from opening_guard import Opening


def reject(label,opening,shape):
    try:
        opening.verify([(label,shape)])
    except ValueError as error:
        assert 'intrudes into ball-opening' in str(error),str(error)
        print('PASS rejected',label)
    else:
        raise AssertionError('Accepted '+label)


def main():
    source=Opening(0,'-z')
    installed=Opening(19,'+z')
    source.verify([('full-height protected bar envelope',Cylinder(47.2306651,109.22,
                   align=(Align.CENTER,Align.CENTER,Align.MAX)))])
    installed.verify([('fixed body below opening',Box(116,116,18.5,
                     align=(Align.CENTER,Align.CENTER,Align.MIN)))])
    # Reproduce the previous cap's actual radial and axial specification.
    cap=(Cylinder(57,3)-Cylinder(49,5)).translate((0,0,19+1.7))
    reject('historical raised cap outside bar profile',installed,cap)
    wide_buffer=(Cylinder(50,1)-Cylinder(43,3)).translate((0,0,18.5))
    reject('flat wide PTFE crossing required setback',installed,wide_buffer)
    reject('new external tab inside ball',source,Box(8,8,2).translate((54,0,-1)))
    print('PASS source and installed coordinate frames, full height, radius and opening setback')


if __name__=='__main__':
    main()
