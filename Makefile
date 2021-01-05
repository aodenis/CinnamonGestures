SHELL= /bin/sh

all: gestured

gestured: gestured.cpp
	g++ -o gestured gestured.cpp -std=c++17 -O3 -Wall `pkg-config --libs --cflags libudev libinput dbus-1`

.PHONY: install
install: gestured
	install -D -o root -g root gestured $(DESTDIR)/usr/bin/gestured
	install -D -o root -g root -m 644 tree/etc/dbus-1/system.d/org.aodenis.gestured.conf $(DESTDIR)/etc/dbus-1/system.d/org.aodenis.gestured.conf
	install -D -o root -g root -m 644 tree/usr/share/dbus-1/system-services/org.aodenis.gestured.service $(DESTDIR)/usr/share/dbus-1/system-services/org.aodenis.gestured.service
	install -D -o root -g root -m 644 tree/lib/systemd/system/gestured.service $(DESTDIR)/lib/systemd/system/gestured.service
	install -d -o root -g root $(DESTDIR)/usr/share/cinnamon/extensions/gestures@aodenis
	install -o root -g root -m 644 gestures@aodenis/* $(DESTDIR)/usr/share/cinnamon/extensions/gestures@aodenis

.PHONY: clean
clean:
	rm -f gestured
