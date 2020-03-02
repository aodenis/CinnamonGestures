SHELL= /bin/sh

all: gestured

gestured: gestured.cpp
	g++ -o gestured gestured.cpp -std=c++17 -Wall -O2 `pkg-config --libs --cflags libudev libinput dbus-1`

.PHONY: install
install: gestured
	install -o root -g root gestured /usr/bin/gestured
	install -o root -g root -m 644 tree/etc/dbus-1/system.d/org.aodenis.gestured.conf /etc/dbus-1/system.d/org.aodenis.gestured.conf
	install -o root -g root -m 644 tree/usr/share/dbus-1/system-services/org.aodenis.gestured.service /usr/share/dbus-1/system-services/org.aodenis.gestured.service
	install -o root -g root -m 644 tree/lib/systemd/system/gestured.service /lib/systemd/system/gestured.service

.PHONY: clean
clean:
	rm -f gestured
