import ApplicationServices
from AppKit import NSWorkspace

def get_antigravity_app():
    workspace = NSWorkspace.sharedWorkspace()
    for app in workspace.runningApplications():
        if app.localizedName() == 'Antigravity' or app.localizedName() == 'antigravity':
            return app
    return None

def print_ui_tree(element, depth=0, max_depth=5):
    if depth > max_depth:
        return
        
    role = "Unknown"
    title = "None"
    
    # Get Role
    err, value = ApplicationServices.AXUIElementCopyAttributeValue(element, ApplicationServices.kAXRoleAttribute, None)
    if err == ApplicationServices.kAXErrorSuccess:
        role = value
        
    # Get Title/Value
    err, value = ApplicationServices.AXUIElementCopyAttributeValue(element, ApplicationServices.kAXTitleAttribute, None)
    if err == ApplicationServices.kAXErrorSuccess and value:
        title = value
    else:
        err, value = ApplicationServices.AXUIElementCopyAttributeValue(element, ApplicationServices.kAXValueAttribute, None)
        if err == ApplicationServices.kAXErrorSuccess and value:
            title = value

    indent = "  " * depth
    print(f"{indent}- [{role}] '{title}'")

    # Get Children
    err, children = ApplicationServices.AXUIElementCopyAttributeValue(element, ApplicationServices.kAXChildrenAttribute, None)
    if err == ApplicationServices.kAXErrorSuccess and children:
        for child in children:
            print_ui_tree(child, depth + 1, max_depth)

def main():
    print("Finding Antigravity application...")
    app = get_antigravity_app()
    if not app:
        print("Could not find Antigravity running. Is it open?")
        return
        
    pid = app.processIdentifier()
    name = app.localizedName()
    print(f"Found app: {name} (PID: {pid})")
    
    print("Creating AXUIElement...")
    app_element = ApplicationServices.AXUIElementCreateApplication(pid)
    
    print("\nDumping UI Tree (Requires Accessibility Permissions)...")
    print_ui_tree(app_element)

if __name__ == "__main__":
    main()
