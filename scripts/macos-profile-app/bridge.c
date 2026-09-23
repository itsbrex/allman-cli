#include <stdio.h>
#include <unistd.h>

/* A pinned engine icon must return through the profile/Shield/account launcher. */
int main(void) {
  char *arguments[] = {"/usr/bin/open", "/Applications/BrowserOS JP.app", NULL};
  execv(arguments[0], arguments);
  perror("Could not open BrowserOS JP launcher");
  return 1;
}
