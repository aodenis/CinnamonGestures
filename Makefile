all: gestured

gestured: gestured.cpp
	g++ -o gestured gestured.cpp -std=c++17 -Wall -O2 `pkg-config --libs --cflags libudev libinput dbus-1`

.PHONY: clean
clean:
	rm -f gestured