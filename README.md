CinnamonGestures
================

CinnamonGestures implements touchpad gestures on Cinnamon Desktop Environment.

Caution & License
-----------------

The version distributed here is a beta version. It still suffers of bugs and glitches and lacks a few features that will be soon added. It is not intended to be used as a final product.

Use at your own risks.

This software is distributed under GNU GPL v3 license. You may find the full text of this license in LICENSE file. 

Installation
------------

CinnamonGestures is made of two distinct parts, an event daemon (*gestured*) and a Cinnamon extension.

Both can be installed at once by a debian package, download it from [Relases tab](https://github.com/aodenis/CinnamonGestures/releases).

Building and installing
-----------------------

```
apt install libudev-dev libdbus-1-dev libinput-dev libstdc++-7-dev
git clone https://github.com/aodenis/CinnamonGestures
cd CinnamonGestures
make
sudo make install
```

How to use
----------

+ Slide three fingers up on your trackpad to display all windows, slide back down to go back to your desktop.
+ Slide four fingers up on your trackpad to display all workspaces, slide back down to go back to your desktop.
+ In both modes, click a window to activate it.
+ In window view, click a window with three fingers to close it.
+ In workspace view, click a workspace with three fingers to close it.
+ Slide four fingers right and left to switch between workspaces. Slide far enough on the right of a non-empty workspace to create a new one.
+ Slide three fingers down to minimize current window.

Unfinished feature
------------------

You may find settings in Cinnamon's extensions menu and enable there switching between windows by sliding three fingers left and right, an unfinished feature.

Roadmap
-------

A proper documentation for this extension will come in the next few days. Then :
+ A button to create new workspaces in workspace overview
+ Possibility to drag windows to other workspaces
+ Four fingers down to show the desktop
+ Finish three finger window switching
+ Support for multiple display
+ Window titles
+ Many glitches and bugs to fix

Contributing
------------

If you want to help this project, you can :
+ Star/Watch this repository
+ Report bugs by opening an issue
+ Submit pull requests
+ Feel free to send me some spare satoshis : bc1qzyr0tl9t40vgdep3ynudrp88fkyqj2ejva7zwh
