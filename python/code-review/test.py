import os

def main():
    print("Running from Python")

    for k, v in sorted(os.environ.items()):
        print(f"{k} => {v}")

if __name__ == '__main__':
    main()
