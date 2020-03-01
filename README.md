CinnamonGestures
================

CinnamonGestures implements touchpad gestures on Cinnamon Desktop Environment

Caution & License
=================

The version here distributed is a beta version. It still suffers of bugs and glitches and lacks a few features that will be soon added. It is not intended to be used as a final product.
Use at your own risks. This software is distributed under GNU GPL v3 license. You may find the full text of this license in LICENSE file. 

Installation
============

CinnamonGestures is made of two distinct parts : a daemon (gestured) and a Cinnamon extension part.
gestured can be installed with a debian package or built. Its purpose is to send libinput's events into DBus' system bus. It is automatically started by the extension.
The extension is a directory (gestures@aodenis/) that must be copied in the directory ~/.local/cinnamon/extensions/ on your machine. Once done, you have to activate the extension in Cinnamon (Settings > Extensions).

Building gestured
=================

Proper instructions will be published in a few days. Along with gestured binary, a few configuration file must be installed on the system. You may find them and their location in *tree* directory.
Simple instructions :
```
git clone https://github.com/aodenis/CinnamonGestures
cd CinnamonGestures
apt install libudev-dev libdbus-1-dev libinput-dev libstdc++-7-dev
make
```

Installation instructions, USE AT YOUR OWN RISKS :
```
sudo make install
cp -r gestures@aodenis ~/.local/share/cinnamon/extensions/
```

Use
===

Slide three fingers up on your trackpad to show all windows, down to go back to your desktop.
Slide four fingers up on your trackpad to show all workspaces, down to go back to your desktop.
In both modes, click a window to activate it.
In window view, click a window with three fingers to close it.
In workspace view, click a workspace with three fingers to close it.
Slide four fingers right and left to switch between workspaces. Slide far enough on the right of a non-empty workspace to create another one.
Slide three fingers down to minimize a window.

Debug
=====

You may find settings in Cinnamon's extensions menu. You may enable there switching between windows by sliding three fingers left and right, an unfinished feature.

Known Bug
=========

This extension sometimes hangs and use 100% CPU. In those cases, restarting Cinnamon is the only way out.

Roadmap
=======

A proper documentation for this extension in the next few days

Contributing
============

If you want to help this project, you can :
+ Star/Watch this repository
+ Report bugs by opening an issue
+ Feel free to support me : bc1qzyr0tl9t40vgdep3ynudrp88fkyqj2ejva7zwh
